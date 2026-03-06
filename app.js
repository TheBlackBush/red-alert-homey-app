'use strict';

const Homey = require('homey');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const WS_URL = 'wss://ws.tzevaadom.co.il/socket?platform=WEB';
const ORIGIN = 'https://www.tzevaadom.co.il';
const MAX_HISTORY = 50;

const THREAT_TYPES = {
  0: { key: 'rockets_missiles', he: 'ירי רקטות וטילים', en: 'Rockets and missiles', category: 'primary' },
  1: { key: 'hazmat', he: 'אירוע חומרים מסוכנים', en: 'Hazardous materials', category: 'other' },
  2: { key: 'terror_infiltration', he: 'חדירת מחבלים', en: 'Terrorist infiltration', category: 'primary' },
  3: { key: 'earthquake', he: 'רעידת אדמה', en: 'Earthquake', category: 'other' },
  4: { key: 'tsunami', he: 'חשש לצונאמי', en: 'Tsunami', category: 'other' },
  5: { key: 'hostile_aircraft', he: 'חדירת כלי טיס עוין', en: 'Hostile aircraft intrusion', category: 'primary' },
  6: { key: 'radiological', he: 'חשש לאירוע רדיולוגי', en: 'Radiological event', category: 'other' },
  7: { key: 'chemical', he: 'חשש לאירוע כימי', en: 'Chemical event', category: 'primary' },
  8: { key: 'homefront_alerts', he: 'התרעות פיקוד העורף', en: 'Home Front alerts', category: 'other' },
};

const SEVERITY_BY_CATEGORY = {
  primary: 'critical',
  'pre-alert': 'warning',
  'all-clear': 'info',
  other: 'warning',
  test: 'warning',
};

const SYSTEM_TYPE = {
  PRE_ALERT: 0,
  END_ALERT: 1,
};

const DEFAULT_THROTTLE_BY_TYPE_MS = {
  primary: 120000,
  'pre-alert': 180000,
  'all-clear': 120000,
  other: 120000,
  test: 0,
};

class RedAlertApp extends Homey.App {
  async onInit() {
    this._active = false;
    this._activeType = null;
    this._connected = false;
    this._lastEvent = null;
    this._lastFlowEvent = null;
    this._history = [];
    this._dedupe = new Map();

    this._cityNameToId = new Map();
    this._cityIdToName = new Map();
    this._loadCitiesDictionary();
    this._loadConfig();

    this._registerCards();
    await this._registerTokens();
    this._connect();

    this.homey.settings.on('set', (key) => {
      if (!['monitoring_enabled', 'selected_city_ids', 'quiet_hours', 'throttle_by_type_ms'].includes(key)) return;

      const prevMonitoring = this._monitoringEnabled;
      this._loadConfig();

      if (key === 'monitoring_enabled' && prevMonitoring !== this._monitoringEnabled) {
        this.log(`[settings] monitoring_enabled changed: ${prevMonitoring} -> ${this._monitoringEnabled}`);

        if (this._monitoringEnabled) {
          if (!this._ws || this._ws.readyState > 1) this._connect();
        } else if (this._ws) {
          this._ws.close();
          this._connected = false;
        }
      }
    });

    this.homey.setInterval(() => this._cleanupDedupe(), 10 * 60 * 1000);

    this.log('Red Alert app initialized (stage 3)');
  }

  _loadCitiesDictionary() {
    try {
      const p = path.join(__dirname, 'data', 'cities.json');
      const raw = fs.readFileSync(p, 'utf8');
      const payload = JSON.parse(raw);
      const cities = payload?.cities || {};

      for (const [name, meta] of Object.entries(cities)) {
        const id = Number(meta?.id);
        if (!Number.isNaN(id)) {
          this._cityNameToId.set(String(name), id);
          this._cityIdToName.set(id, String(name));
        }
      }

      this.log(`Loaded ${this._cityNameToId.size} cities from dictionary`);
    } catch (err) {
      this.error('Failed loading cities dictionary', err);
    }
  }

  _loadConfig() {
    this._monitoringEnabled = this.homey.settings.get('monitoring_enabled') !== false;

    const legacyCities = this.homey.settings.get('cities') || [];
    const selectedCityIds = this.homey.settings.get('selected_city_ids');

    if (Array.isArray(selectedCityIds) && selectedCityIds.length) {
      this._selectedCityIds = selectedCityIds.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
    } else {
      this._selectedCityIds = (Array.isArray(legacyCities) ? legacyCities : [])
        .map((name) => this._cityNameToId.get(String(name).trim()))
        .filter((n) => Number.isFinite(n));
    }

    this._quietHours = this.homey.settings.get('quiet_hours') || { enabled: false, start: 23, end: 6 };
    this._throttleByTypeMs = {
      ...DEFAULT_THROTTLE_BY_TYPE_MS,
      ...(this.homey.settings.get('throttle_by_type_ms') || {}),
    };
  }

  _registerCards() {
    this._triggerRedAlert = this.homey.flow.getTriggerCard('red_alert_received');
    this._triggerPreAlert = this.homey.flow.getTriggerCard('pre_alert_received');
    this._triggerAllClear = this.homey.flow.getTriggerCard('all_clear_received');
    this._triggerTestAlert = this.homey.flow.getTriggerCard('test_alert_received');

    this.homey.flow.getConditionCard('is_monitoring_enabled')
      .registerRunListener(async () => this._monitoringEnabled);

    this.homey.flow.getConditionCard('is_alert_active')
      .registerRunListener(async () => this._active);

    this.homey.flow.getConditionCard('matches_threat_key')
      .registerRunListener(async (args) => {
        return String(this._lastFlowEvent?.threatKey || '') === String(args.threat_key || '');
      });

    this.homey.flow.getConditionCard('matches_severity')
      .registerRunListener(async (args) => {
        return String(this._lastFlowEvent?.severity || '') === String(args.severity || '');
      });

    this.homey.flow.getActionCard('set_monitoring_enabled')
      .registerRunListener(async (args) => {
        this._monitoringEnabled = !!args.enabled;
        await this.homey.settings.set('monitoring_enabled', this._monitoringEnabled);
        return true;
      });

    this.homey.flow.getActionCard('test_trigger')
      .registerRunListener(async (args) => {
        const threatId = Number(args.threat_id || 0);
        const threat = THREAT_TYPES[threatId] || THREAT_TYPES[0];

        const event = {
          id: `test-${Date.now()}`,
          type: threat.category === 'primary' ? 'primary' : 'other',
          title: args.title || 'Test alert',
          category: 'test',
          severity: 'warning',
          areas: [args.area || 'Test Area'],
          threatId,
          threatKey: threat.key,
          threatNameHe: threat.he,
          threatNameEn: threat.en,
          time: Date.now(),
        };
        await this._emitEvent(event, this._triggerTestAlert || this._triggerRedAlert);
        return true;
      });

    this.homey.flow.getActionCard('refresh_summary_token')
      .registerRunListener(async () => {
        await this._updateSummaryToken(this._lastEvent);
        await this._updateMessageToken(this._lastEvent, 'short', 'he');
        return true;
      });

    this.homey.flow.getActionCard('build_message_template')
      .registerRunListener(async (args) => {
        const mode = String(args.mode || 'short');
        const lang = String(args.lang || 'he');
        await this._updateMessageToken(this._lastEvent, mode, lang);
        return true;
      });

    this.homey.flow.getActionCard('build_alert_link')
      .registerRunListener(async (args) => {
        const source = String(args.source || 'oref');
        await this._updateLinkToken(this._lastEvent, source);
        return true;
      });
  }

  async _registerTokens() {
    this._lastAlertSummaryToken = await this.homey.flow.createToken('last_alert_summary', {
      type: 'string',
      title: {
        en: 'Last alert summary',
        he: 'סיכום התראה אחרונה',
      },
    });

    this._lastAlertMessageToken = await this.homey.flow.createToken('last_alert_message', {
      type: 'string',
      title: {
        en: 'Last alert message',
        he: 'הודעת התראה אחרונה',
      },
    });

    this._lastAlertLinkToken = await this.homey.flow.createToken('last_alert_link', {
      type: 'string',
      title: {
        en: 'Last alert link',
        he: 'קישור התראה אחרון',
      },
    });

    try {
      await this._updateSummaryToken(this._lastEvent);
      await this._updateMessageToken(this._lastEvent, 'short', 'he');
      await this._updateLinkToken(this._lastEvent, 'oref');
    } catch (err) {
      this.error('Failed to init flow tokens', err);
    }
  }

  _connect() {
    if (!this._monitoringEnabled) {
      this.log('Monitoring disabled, websocket connect skipped');
      return;
    }

    this.log('Opening Tzeva Adom websocket...');
    this._ws = new WebSocket(WS_URL, {
      headers: {
        Origin: ORIGIN,
        Referer: ORIGIN,
      },
    });

    this._ws.on('open', () => {
      this._connected = true;
      this.log('Connected to Tzeva Adom websocket');
    });

    this._ws.on('message', async (raw) => {
      try {
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
        if (!text || !text.trim()) return;

        const message = JSON.parse(text);
        await this._handleMessage(message);
      } catch (err) {
        // WS occasionally emits partial/empty frames; keep listening quietly.
        const msg = String(err?.message || '');
        if (msg.includes('Unexpected end of JSON input') || msg.includes('Unexpected token')) {
          this.log('[ws] ignored non-JSON/partial frame');
          return;
        }
        this.error('Failed parsing websocket message', err);
      }
    });

    this._ws.on('close', () => {
      this._connected = false;
      this.homey.setTimeout(() => this._connect(), 5000);
    });

    this._ws.on('error', (err) => this.error('Websocket error', err));
  }

  async _handleMessage(message) {
    if (!this._monitoringEnabled || !message?.data) return;

    if (message.type === 'ALERT') {
      this.log(`[ws] ALERT received: threat=${message?.data?.threat} cities=${Array.isArray(message?.data?.cities) ? message.data.cities.length : 0}`);
      const threatId = Number(message.data.threat);
      const threat = THREAT_TYPES[threatId];
      if (!threat || message.data.isDrill) return;

      const areasByName = Array.isArray(message.data.cities) ? message.data.cities : [];
      const matched = this._filterAreasByNames(areasByName);
      if (!matched.length) {
        this.log('[ws] ALERT ignored: no matched cities for current selection');
        return;
      }

      const eventType = threat.category === 'primary' ? 'primary' : 'other';

      const event = {
        id: `ALERT-${message.data.notificationId || Date.now()}`,
        type: eventType,
        title: threat.en,
        category: threat.category,
        severity: SEVERITY_BY_CATEGORY[threat.category],
        areas: matched,
        threatId,
        threatKey: threat.key,
        threatNameHe: threat.he,
        threatNameEn: threat.en,
        time: Number(message.data.time) * 1000 || Date.now(),
      };

      await this._emitEvent(event, this._triggerRedAlert);
      this._active = true;
      this._activeType = eventType;
      return;
    }

    if (message.type === 'SYSTEM_MESSAGE') {
      const instructionType = Number(message.data.instructionType);
      this.log(`[ws] SYSTEM_MESSAGE received: instructionType=${instructionType} citiesIds=${Array.isArray(message?.data?.citiesIds) ? message.data.citiesIds.length : 0}`);
      const areaIds = Array.isArray(message.data.citiesIds) ? message.data.citiesIds : [];
      const matched = this._filterAreasByIds(areaIds);
      if (!matched.length) {
        this.log('[ws] SYSTEM_MESSAGE ignored: no matched cities for current selection');
        return;
      }

      if (instructionType === SYSTEM_TYPE.PRE_ALERT && this._activeType === 'primary') return;

      if (instructionType === SYSTEM_TYPE.PRE_ALERT) {
        if (this._isQuietHours()) return;

        const event = {
          id: `PRE-${message.data.notificationId || Date.now()}`,
          type: 'pre-alert',
          title: message.data.titleHe || 'Early warning',
          category: 'pre-alert',
          severity: SEVERITY_BY_CATEGORY['pre-alert'],
          areas: matched,
          threatId: 8,
          threatKey: 'pre_alert',
          threatNameHe: 'התרעה מוקדמת',
          threatNameEn: 'Early warning',
          time: Number(message.data.time) * 1000 || Date.now(),
        };
        await this._emitEvent(event, this._triggerPreAlert);
        return;
      }

      if (instructionType === SYSTEM_TYPE.END_ALERT) {
        const event = {
          id: `END-${message.data.notificationId || Date.now()}`,
          type: 'all-clear',
          title: message.data.titleHe || 'All clear',
          category: 'all-clear',
          severity: SEVERITY_BY_CATEGORY['all-clear'],
          areas: matched,
          threatId: 8,
          threatKey: 'all_clear',
          threatNameHe: 'סיום אירוע',
          threatNameEn: 'All clear',
          time: Number(message.data.time) * 1000 || Date.now(),
        };
        await this._emitEvent(event, this._triggerAllClear);

        this._active = false;
        this._activeType = null;
      }
    }
  }

  _filterAreasByNames(areas) {
    if (!this._selectedCityIds.length) return areas;
    const selected = new Set(this._selectedCityIds);
    return areas.filter((name) => selected.has(this._cityNameToId.get(String(name).trim())));
  }

  _filterAreasByIds(areaIds) {
    const ids = areaIds.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
    if (!this._selectedCityIds.length) {
      return ids.map((id) => this._cityIdToName.get(id) || String(id));
    }

    const selected = new Set(this._selectedCityIds);
    const matched = ids.filter((id) => selected.has(id));
    return matched.map((id) => this._cityIdToName.get(id) || String(id));
  }

  _isQuietHours() {
    if (!this._quietHours?.enabled) return false;
    const now = new Date();
    const hour = now.getHours();
    const start = Number(this._quietHours.start);
    const end = Number(this._quietHours.end);
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    if (start <= end) return hour >= start && hour <= end;
    return hour >= start || hour <= end;
  }

  _buildAlertSummary(event) {
    if (!event) return 'No alerts yet';
    const ts = new Date(event.time || Date.now()).toLocaleString('he-IL', { hour12: false });
    const threat = event.threatNameHe || event.threatNameEn || event.title || '-';
    const areas = Array.isArray(event.areas) ? event.areas.join(', ') : '-';
    return `[${ts}] ${threat} | severity=${event.severity || '-'} | areas=${areas}`;
  }

  async _updateSummaryToken(event) {
    if (!this._lastAlertSummaryToken) return;
    const summary = this._buildAlertSummary(event);
    await this._lastAlertSummaryToken.setValue(summary);
  }

  _buildAlertMessage(event, mode = 'short', lang = 'he') {
    if (!event) {
      return lang === 'he' ? 'אין התראות עדיין.' : 'No alerts yet.';
    }

    const ts = new Date(event.time || Date.now()).toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { hour12: false });
    const threat = lang === 'he'
      ? (event.threatNameHe || event.threatNameEn || event.title || '-')
      : (event.threatNameEn || event.threatNameHe || event.title || '-');
    const areas = Array.isArray(event.areas) ? event.areas.join(', ') : '-';

    if (mode === 'full') {
      if (lang === 'he') {
        return `🚨 התראה: ${threat}\nאזורים: ${areas}\nחומרה: ${event.severity || '-'}\nסוג: ${event.threatKey || '-'} (#${event.threatId ?? '-'})\nזמן: ${ts}`;
      }
      return `🚨 Alert: ${threat}\nAreas: ${areas}\nSeverity: ${event.severity || '-'}\nType: ${event.threatKey || '-'} (#${event.threatId ?? '-'})\nTime: ${ts}`;
    }

    if (lang === 'he') {
      return `🚨 ${threat} | ${areas} | ${event.severity || '-'} | ${ts}`;
    }
    return `🚨 ${threat} | ${areas} | ${event.severity || '-'} | ${ts}`;
  }

  async _updateMessageToken(event, mode = 'short', lang = 'he') {
    if (!this._lastAlertMessageToken) return;
    const message = this._buildAlertMessage(event, mode, lang);
    await this._lastAlertMessageToken.setValue(message);
  }

  _buildAlertLink(event, source = 'oref') {
    const city = Array.isArray(event?.areas) && event.areas.length ? event.areas[0] : '';
    if (source === 'tzevaadom') {
      return city
        ? `https://www.tzevaadom.co.il/en/cities/${encodeURIComponent(city)}`
        : 'https://www.tzevaadom.co.il/';
    }

    // official source default
    return 'https://www.oref.org.il/eng';
  }

  async _updateLinkToken(event, source = 'oref') {
    if (!this._lastAlertLinkToken) return;
    const link = this._buildAlertLink(event, source);
    await this._lastAlertLinkToken.setValue(link);
  }

  async _emitEvent(event, card) {
    const now = Date.now();
    const throttleMs = Number(this._throttleByTypeMs[event.type] || 0);
    const dedupeKey = `${event.type}:${event.id}`;
    const last = this._dedupe.get(dedupeKey) || 0;
    if (now - last < throttleMs) return;
    this._dedupe.set(dedupeKey, now);

    this._lastEvent = event;
    this._lastFlowEvent = event;
    this._history.unshift(event);
    if (this._history.length > MAX_HISTORY) this._history.length = MAX_HISTORY;

    await this._updateSummaryToken(event);
    await this._updateMessageToken(event, 'short', 'he');
    await this._updateLinkToken(event, 'oref');

    const tokens = {
      title: event.title,
      category: event.category,
      areas: event.areas.join(', '),
      timestamp: new Date(event.time).toISOString(),
      severity: event.severity,
      threat_id: String(event.threatId ?? ''),
      threat_key: event.threatKey || '',
      threat_name_he: event.threatNameHe || '',
      threat_name_en: event.threatNameEn || '',
    };

    try {
      await card.trigger(tokens);
      this.log(`[flow] trigger fired: ${event.type} | ${tokens.threat_key} | ${tokens.areas}`);
    } catch (err) {
      this.error(`[flow] trigger failed: ${event.type}`, err);
    }
  }

  _cleanupDedupe() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of this._dedupe.entries()) {
      if (ts < cutoff) this._dedupe.delete(key);
    }
  }

  getPublicState() {
    return {
      monitoringEnabled: this._monitoringEnabled,
      connected: this._connected,
      active: this._active,
      activeType: this._activeType,
      selectedCityIds: this._selectedCityIds,
      selectedCities: this._selectedCityIds.map((id) => this._cityIdToName.get(id) || String(id)),
      quietHours: this._quietHours,
      throttleByTypeMs: this._throttleByTypeMs,
      lastEvent: this._lastEvent,
      history: this._history.slice(0, 10),
      threatTypes: this.getThreatTypes(),
      summary: this._buildAlertSummary(this._lastEvent),
      messageHe: this._buildAlertMessage(this._lastEvent, 'short', 'he'),
      messageEn: this._buildAlertMessage(this._lastEvent, 'short', 'en'),
      linkOref: this._buildAlertLink(this._lastEvent, 'oref'),
      linkTzevaadom: this._buildAlertLink(this._lastEvent, 'tzevaadom'),
    };
  }

  getThreatTypes() {
    return Object.entries(THREAT_TYPES).map(([id, t]) => ({
      id: Number(id),
      key: t.key,
      he: t.he,
      en: t.en,
      category: t.category,
    }));
  }

  getCities(limit = 500) {
    const entries = [];
    for (const [name, id] of this._cityNameToId.entries()) {
      entries.push({ id, name });
      if (entries.length >= limit) break;
    }
    return entries;
  }

  async setMonitoringEnabled(enabled) {
    this._monitoringEnabled = !!enabled;
    await this.homey.settings.set('monitoring_enabled', this._monitoringEnabled);

    if (this._monitoringEnabled && (!this._ws || this._ws.readyState > 1)) {
      this._connect();
    }

    if (!this._monitoringEnabled && this._ws) {
      this._ws.close();
      this._connected = false;
    }

    return this._monitoringEnabled;
  }

  async setCities(cities) {
    const normalized = Array.isArray(cities) ? cities.map((x) => String(x).trim()).filter(Boolean) : [];

    const ids = normalized.map((v) => {
      const numeric = Number(v);
      if (!Number.isNaN(numeric)) return numeric;
      return this._cityNameToId.get(v);
    }).filter((x) => Number.isFinite(x));

    this._selectedCityIds = Array.from(new Set(ids));
    await this.homey.settings.set('selected_city_ids', this._selectedCityIds);
    return this._selectedCityIds;
  }

  async setPolicies({ quietHours, throttleByTypeMs }) {
    if (quietHours && typeof quietHours === 'object') {
      this._quietHours = {
        enabled: !!quietHours.enabled,
        start: Number(quietHours.start ?? 23),
        end: Number(quietHours.end ?? 6),
      };
      await this.homey.settings.set('quiet_hours', this._quietHours);
    }

    if (throttleByTypeMs && typeof throttleByTypeMs === 'object') {
      this._throttleByTypeMs = {
        ...this._throttleByTypeMs,
        ...throttleByTypeMs,
      };
      await this.homey.settings.set('throttle_by_type_ms', this._throttleByTypeMs);
    }

    return {
      quietHours: this._quietHours,
      throttleByTypeMs: this._throttleByTypeMs,
    };
  }
}

module.exports = RedAlertApp;
