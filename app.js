'use strict';

const Homey = require('homey');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WS_URL = 'wss://ws.tzevaadom.co.il/socket?platform=ANDROID';
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

const WS_PING_INTERVAL_MS = 45000;
const WS_STALE_TIMEOUT_MS = 150000;

class RedAlertApp extends Homey.App {
  async onInit() {
    this._active = false;
    this._activeType = null;
    this._connected = false;
    this._lastWsMessageAt = 0;
    this._lastWsPingAt = 0;
    this._lastWsHealthLogAt = 0;
    this._lastWsEventType = 'none';
    this._lastEvent = null;
    this._lastFlowEvent = null;
    this._history = [];
    this._dedupe = new Map();

    this._cityNameToId = new Map();
    this._cityIdToName = new Map();
    this._cityIdToMeta = new Map();
    this._normalizedCityToId = new Map();

    this._diag = {
      wsConnects: 0,
      wsReconnects: 0,
      wsCloses: 0,
      wsErrors: 0,
      wsMessages: 0,
      wsIgnoredFrames: 0,
      flowTriggersFired: 0,
      flowTriggersFailed: 0,
      dedupeDrops: 0,
      lastError: null,
    };
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
    this.homey.setInterval(() => this._wsWatchdog(), 30000);

    this.log('Red Alert app initialized (stage 3)');
  }

  _normalizeAreaName(name) {
    return String(name || '')
      .trim()
      .replace(/[׳']/g, '')
      .replace(/["”״]/g, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
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
          const he = String(meta?.he || name || '');
          const en = String(meta?.en || he || '');
          this._cityNameToId.set(String(name), id);
          this._cityIdToName.set(id, he);
          this._cityIdToMeta.set(id, { he, en });
          this._normalizedCityToId.set(this._normalizeAreaName(name), id);
          this._normalizedCityToId.set(this._normalizeAreaName(he), id);
          this._normalizedCityToId.set(this._normalizeAreaName(en), id);
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
      title: 'Last alert summary',
    });

    this._lastAlertMessageToken = await this.homey.flow.createToken('last_alert_message', {
      type: 'string',
      title: 'Last alert message',
    });

    this._lastAlertLinkToken = await this.homey.flow.createToken('last_alert_link', {
      type: 'string',
      title: 'Last alert link',
    });

    try {
      await this._updateSummaryToken(this._lastEvent);
      await this._updateMessageToken(this._lastEvent, 'short', 'he');
      await this._updateLinkToken(this._lastEvent, 'oref');
    } catch (err) {
      this.error('Failed to init flow tokens', err);
    }
  }

  _wsWatchdog() {
    if (!this._monitoringEnabled) return;

    const now = Date.now();
    const readyState = this._ws ? this._ws.readyState : -1;
    const idleSec = this._lastWsMessageAt ? Math.round((now - this._lastWsMessageAt) / 1000) : -1;

    if (now - this._lastWsHealthLogAt > 120000) {
      this._lastWsHealthLogAt = now;
      this.log(`[ws] health state=${readyState} connected=${this._connected} idleSec=${idleSec} lastType=${this._lastWsEventType}`);
    }

    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;

    const idleMs = this._lastWsMessageAt ? (now - this._lastWsMessageAt) : Infinity;
    if (idleMs > WS_STALE_TIMEOUT_MS) {
      this.log(`[ws] stale connection detected (${Math.round(idleMs / 1000)}s idle), reconnecting`);
      try { this._ws.terminate(); } catch (_) {}
    }
  }

  _connect() {
    if (!this._monitoringEnabled) {
      this.log('Monitoring disabled, websocket connect skipped');
      return;
    }

    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.log('Opening Tzeva Adom websocket...');
    this._ws = new WebSocket(WS_URL, {
      handshakeTimeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36',
        Origin: ORIGIN,
        Referer: ORIGIN,
        tzofar: crypto.randomBytes(16).toString('hex'),
      },
    });

    this._ws.on('open', () => {
      this._connected = true;
      this._diag.wsConnects += 1;
      this._lastWsMessageAt = Date.now();
      this.log('Connected to Tzeva Adom websocket');

      if (this._wsPingTimer) clearInterval(this._wsPingTimer);
      this._wsPingTimer = this.homey.setInterval(() => {
        try {
          if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._lastWsPingAt = Date.now();
            this._ws.ping();
          }
        } catch (_) {}
      }, WS_PING_INTERVAL_MS);
    });

    this._ws.on('pong', () => {
      this._lastWsMessageAt = Date.now();
    });

    this._ws.on('message', async (raw) => {
      try {
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
        if (!text || !text.trim()) {
          this._diag.wsIgnoredFrames += 1;
          return;
        }

        this._diag.wsMessages += 1;
        this._lastWsMessageAt = Date.now();
        const message = JSON.parse(text);
        await this._handleMessage(message);
      } catch (err) {
        // WS occasionally emits partial/empty frames; keep listening quietly.
        const msg = String(err?.message || '');
        if (msg.includes('Unexpected end of JSON input') || msg.includes('Unexpected token')) {
          this._diag.wsIgnoredFrames += 1;
          this.log('[ws] ignored non-JSON/partial frame');
          return;
        }
        this._diag.lastError = msg;
        this.error('Failed parsing websocket message', err);
      }
    });

    this._ws.on('close', () => {
      this._connected = false;
      this._diag.wsCloses += 1;
      this._diag.wsReconnects += 1;
      if (this._wsPingTimer) {
        clearInterval(this._wsPingTimer);
        this._wsPingTimer = null;
      }
      const retryMs = 5000 + Math.floor(Math.random() * 2000);
      this.homey.setTimeout(() => this._connect(), retryMs);
    });

    this._ws.on('error', (err) => {
      this._diag.wsErrors += 1;
      this._diag.lastError = String(err?.message || err);
      this.error('Websocket error', err);
    });
  }

  async _handleMessage(message) {
    if (!this._monitoringEnabled || !message?.data) return;

    if (message.type === 'ALERT') {
      this._lastWsEventType = 'ALERT';
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
      this._lastWsEventType = `SYSTEM_${instructionType}`;
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

    return areas.filter((name) => {
      const raw = String(name || '').trim();
      const direct = this._cityNameToId.get(raw);
      if (selected.has(direct)) return true;

      const normalized = this._normalizeAreaName(raw);
      const normalizedId = this._normalizedCityToId.get(normalized);
      return selected.has(normalizedId);
    });
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

  _timeToMinutes(v, fallbackMinutes) {
    if (typeof v === 'string' && v.includes(':')) {
      const [hRaw, mRaw] = v.split(':');
      const h = Number(hRaw);
      const m = Number(mRaw);
      if (!Number.isNaN(h) && !Number.isNaN(m)) return (h * 60) + m;
    }

    const asNum = Number(v);
    if (!Number.isNaN(asNum)) return Math.max(0, Math.min(23, asNum)) * 60;
    return fallbackMinutes;
  }

  _isQuietHours() {
    if (!this._quietHours?.enabled) return false;
    const now = new Date();
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();

    const start = this._timeToMinutes(this._quietHours.start, 23 * 60);
    const end = this._timeToMinutes(this._quietHours.end, 6 * 60);

    if (start <= end) return nowMinutes >= start && nowMinutes <= end;
    return nowMinutes >= start || nowMinutes <= end;
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

    const areaKey = Array.isArray(event.areas)
      ? [...event.areas].map((a) => this._normalizeAreaName(a)).sort().join('|')
      : 'none';
    const bucket = Math.floor((event.time || now) / 60000);

    const dedupeKey = `${event.type}:${event.id}`;
    const dedupeSignature = `${event.type}:${event.threatId ?? 'na'}:${areaKey}:${bucket}`;

    const lastById = this._dedupe.get(dedupeKey) || 0;
    const lastBySig = this._dedupe.get(dedupeSignature) || 0;
    if ((now - lastById < throttleMs) || (now - lastBySig < throttleMs)) {
      this._diag.dedupeDrops += 1;
      return;
    }

    this._dedupe.set(dedupeKey, now);
    this._dedupe.set(dedupeSignature, now);

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
      alert_message: this._buildAlertMessage(event, 'short', 'he'),
    };

    try {
      await card.trigger(tokens);
      this._diag.flowTriggersFired += 1;
      this.log(`[flow] trigger fired: ${event.type} | ${tokens.threat_key} | ${tokens.areas}`);
    } catch (err) {
      this._diag.flowTriggersFailed += 1;
      this._diag.lastError = String(err?.message || err);
      this.error(`[flow] trigger failed: ${event.type}`, err);
    }
  }

  _cleanupDedupe() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of this._dedupe.entries()) {
      if (ts < cutoff) this._dedupe.delete(key);
    }
  }

  getDiagnostics() {
    return {
      ws: {
        connected: this._connected,
        readyState: this._ws ? this._ws.readyState : -1,
        lastMessageAt: this._lastWsMessageAt || null,
        lastPingAt: this._lastWsPingAt || null,
        lastEventType: this._lastWsEventType,
      },
      selectedCityIdsCount: this._selectedCityIds.length,
      stats: { ...this._diag },
      lastEventId: this._lastEvent?.id || null,
      lastEventType: this._lastEvent?.type || null,
      quietHours: this._quietHours,
      throttleByTypeMs: this._throttleByTypeMs,
      now: Date.now(),
    };
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
      diagnostics: this.getDiagnostics(),
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
    for (const [id, meta] of this._cityIdToMeta.entries()) {
      entries.push({ id, he: meta.he, en: meta.en, name: meta.he });
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
        start: quietHours.start ?? '23:00',
        end: quietHours.end ?? '06:00',
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
