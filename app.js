'use strict';

const Homey = require('homey');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WS_BASE_URL = 'wss://ws.tzevaadom.co.il/socket';
const ORIGIN = 'https://www.tzevaadom.co.il';
const MAX_HISTORY = 50;

const THREAT_TYPES = {
  0: {
    key: 'rockets_missiles', he: 'ירי רקטות וטילים', en: 'Rockets and missiles', category: 'primary',
  },
  1: {
    key: 'hazmat', he: 'אירוע חומרים מסוכנים', en: 'Hazardous materials', category: 'other',
  },
  2: {
    key: 'terror_infiltration', he: 'חדירת מחבלים', en: 'Terrorist infiltration', category: 'primary',
  },
  3: {
    key: 'earthquake', he: 'רעידת אדמה', en: 'Earthquake', category: 'other',
  },
  4: {
    key: 'tsunami', he: 'חשש לצונאמי', en: 'Tsunami', category: 'other',
  },
  5: {
    key: 'hostile_aircraft', he: 'חדירת כלי טיס עוין', en: 'Hostile aircraft intrusion', category: 'primary',
  },
  6: {
    key: 'radiological', he: 'חשש לאירוע רדיולוגי', en: 'Radiological event', category: 'other',
  },
  7: {
    key: 'chemical', he: 'חשש לאירוע כימי', en: 'Chemical event', category: 'primary',
  },
  8: {
    key: 'homefront_alerts', he: 'התרעות פיקוד העורף', en: 'Home Front alerts', category: 'other',
  },
};

const SEVERITY_BY_CATEGORY = {
  primary: 'critical',
  'pre-alert': 'warning',
  'all-clear': 'info',
  other: 'warning',
  test: 'warning',
};

const SEVERITY_LABELS = {
  critical: { he: 'קריטית', en: 'Critical' },
  warning: { he: 'אזהרה', en: 'Warning' },
  info: { he: 'מידע', en: 'Info' },
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
const WS_RECONNECT_BASE_MS = 5000;
const WS_RECONNECT_MAX_MS = 60000;
const WS_RECONNECT_FACTOR = 1.6;
const WS_MAX_STREAK_BEFORE_HARD_RESET = 6;
const WS_PLATFORMS = ['WEB', 'ANDROID'];
const NATIONWIDE_CITY_ID = 10000000;
const NATIONWIDE_ALIASES = ['רחבי הארץ', 'ברחבי הארץ', 'כל הארץ', 'nationwide'];
const DEDUPE_MIN_WINDOW_MS = 60000;
const OREF_ALERTS_URL = 'https://www.oref.org.il/warningMessages/alert/Alerts.json';
const OREF_FALLBACK_POLL_MS = 15000;
const INFER_ALL_CLEAR_GRACE_MS = 3 * 60 * 1000;
const RUNTIME_STATE_KEY = 'runtime_state_v1';
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const APP_TIMEZONE = 'Asia/Jerusalem';

const AREA_ALIASES = {
  'תל אביב יפו': 'תל אביב - דרום העיר ויפו',
  'תל אביב': 'תל אביב - מרכז העיר',
  ירושלים: 'ירושלים - מערב',
  'באר שבע': 'באר שבע',
  'ראשון לציון': 'ראשון לציון - מערב',
  מודיעין: 'מודיעין מכבים רעות',
  'רחבי הארץ': '__NATIONWIDE__',
};

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
    this._areaMetaByName = new Map();
    this._areaMetaByNormalized = new Map();

    this._diag = {
      wsConnects: 0,
      wsReconnects: 0,
      wsReconnectScheduled: 0,
      wsHardResets: 0,
      wsPlatformSwitches: 0,
      wsCloses: 0,
      wsErrors: 0,
      wsMessages: 0,
      wsIgnoredFrames: 0,
      fallbackPollRuns: 0,
      fallbackPollHits: 0,
      inferredAllClears: 0,
      flowTriggersFired: 0,
      flowTriggersFailed: 0,
      dedupeDrops: 0,
      unknownAreaMisses: 0,
      metadataAreaMisses: 0,
      nationwideMatches: 0,
      lastError: null,
    };

    this._wsReconnectAttempt = 0;
    this._wsDisconnectStreak = 0;
    this._wsReconnectTimer = null;
    this._lastFallbackPollAt = 0;
    this._lastFallbackSourceAt = 0;
    this._activePrimaryLastSeenAt = 0;
    this._loadCitiesDictionary();
    this._loadAreaMetadata();
    this._loadConfig();
    this._restoreRuntimeState();
    this._cleanupHistory();

    this._registerCards();
    await this._registerTokens();
    this._connect();

    this.homey.settings.on('set', (key) => {
      if (!['monitoring_enabled', 'selected_city_ids', 'quiet_hours', 'throttle_by_type_ms', 'settings_lang'].includes(key)) return;

      const prevMonitoring = this._monitoringEnabled;
      this._loadConfig();

      if (key === 'monitoring_enabled' && prevMonitoring !== this._monitoringEnabled) {
        this.log(`[settings] monitoring_enabled changed: ${prevMonitoring} -> ${this._monitoringEnabled}`);

        if (this._monitoringEnabled) {
          if (!this._ws || this._ws.readyState > 1) this._connect();
        } else {
          if (this._ws) {
            this._ws.close();
            this._connected = false;
          }
          if (this._wsReconnectTimer) {
            clearTimeout(this._wsReconnectTimer);
            this._wsReconnectTimer = null;
          }
          this._wsReconnectAttempt = 0;
          this._wsDisconnectStreak = 0;
          this._wsPlatform = this._wsPreferredPlatform;
          this._wsFallbackActive = false;
        }
      }
    });

    this.homey.setInterval(() => this._cleanupDedupe(), 10 * 60 * 1000);
    this.homey.setInterval(() => this._cleanupHistory(), 10 * 60 * 1000);
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

      for (const [key, meta] of Object.entries(cities)) {
        const id = Number(meta?.id ?? key);
        if (Number.isNaN(id)) continue;

        const he = String(meta?.he || '').trim();
        const en = String(meta?.en || he || '').trim();
        const fallbackName = String(key || '').trim();
        const primaryName = he || en || fallbackName;

        this._cityNameToId.set(String(key), id);
        if (primaryName) this._cityNameToId.set(primaryName, id);
        if (he) this._cityNameToId.set(he, id);
        if (en) this._cityNameToId.set(en, id);

        this._cityIdToName.set(id, he || en || fallbackName || String(id));
        this._cityIdToMeta.set(id, {
          he: he || en || fallbackName || String(id),
          en: en || he || fallbackName || String(id),
          areaId: Number(meta?.areaId ?? meta?.area),
        });

        this._normalizedCityToId.set(this._normalizeAreaName(String(key)), id);
        if (fallbackName) this._normalizedCityToId.set(this._normalizeAreaName(fallbackName), id);
        if (he) this._normalizedCityToId.set(this._normalizeAreaName(he), id);
        if (en) this._normalizedCityToId.set(this._normalizeAreaName(en), id);
      }

      for (const [alias, target] of Object.entries(AREA_ALIASES)) {
        if (target === '__NATIONWIDE__') {
          this._normalizedCityToId.set(this._normalizeAreaName(alias), NATIONWIDE_CITY_ID);
          continue;
        }
        const targetId = this._cityNameToId.get(target);
        if (targetId) this._normalizedCityToId.set(this._normalizeAreaName(alias), targetId);
      }

      this.log(`Loaded ${this._cityNameToId.size} cities from dictionary`);
    } catch (err) {
      this.error('Failed loading cities dictionary', err);
    }
  }

  _loadAreaMetadata() {
    try {
      const p = path.join(__dirname, 'data', 'area_metadata.json');
      const raw = fs.readFileSync(p, 'utf8');
      const payload = JSON.parse(raw);
      const areas = payload?.areas || {};
      const normalized = payload?.normalized || {};

      this._areaMetaByName = new Map(Object.entries(areas));
      this._areaMetaByNormalized = new Map(Object.entries(normalized));

      this.log(`Loaded area metadata: areas=${this._areaMetaByName.size}, normalized=${this._areaMetaByNormalized.size}`);
    } catch (err) {
      this.error('Failed loading area metadata', err);
    }
  }

  _resolveAreaMetadata(name) {
    const raw = String(name || '').trim();
    if (!raw) return null;

    const direct = this._areaMetaByName.get(raw);
    if (direct) return { area: raw, m: direct.m, d: direct.d };

    const normalized = this._normalizeAreaName(raw);
    const byNormalized = this._areaMetaByNormalized.get(normalized);
    if (byNormalized) return byNormalized;

    this._diag.metadataAreaMisses += 1;
    return null;
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

    const settingsLang = String(this.homey.settings.get('settings_lang') || 'he').toLowerCase();
    this._settingsLang = settingsLang === 'en' ? 'en' : 'he';

    const preferred = String(this.homey.settings.get('ws_platform_preferred') || 'WEB').toUpperCase();
    this._wsPreferredPlatform = WS_PLATFORMS.includes(preferred) ? preferred : 'WEB';
    this._wsAutoFallback = this.homey.settings.get('ws_auto_fallback') !== false;
    if (!this._wsPlatform || !WS_PLATFORMS.includes(this._wsPlatform)) {
      this._wsPlatform = this._wsPreferredPlatform;
    }
    this._wsFallbackActive = this._wsPlatform !== this._wsPreferredPlatform;
  }

  _registerCards() {
    this._triggerRedAlert = this.homey.flow.getTriggerCard('red_alert_received');
    this._triggerPreAlert = this.homey.flow.getTriggerCard('pre_alert_received');
    this._triggerAllClear = this.homey.flow.getTriggerCard('all_clear_received');

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

    this.homey.flow.getActionCard('build_message_template')
      .registerRunListener(async (args) => {
        const mode = String(args.mode || 'full');
        await this._updateMessageToken(this._lastEvent, mode);
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
    this._lastAlertMessageToken = await this.homey.flow.createToken('last_alert_message', {
      type: 'string',
      title: 'Last alert message',
    });

    this._lastAlertLinkToken = await this.homey.flow.createToken('last_alert_link', {
      type: 'string',
      title: 'Last alert link',
    });

    try {
      await this._updateMessageToken(this._lastEvent, 'full');
      await this._updateLinkToken(this._lastEvent, 'tzevaadom');
    } catch (err) {
      this.error('Failed to init flow tokens', err);
    }
  }

  _scheduleReconnect(reason = 'close') {
    if (!this._monitoringEnabled) return;
    if (this._wsReconnectTimer) return;

    this._wsReconnectAttempt += 1;
    this._diag.wsReconnectScheduled += 1;
    this._maybeSwitchPlatform(reason);

    const backoff = Math.min(
      WS_RECONNECT_BASE_MS * (WS_RECONNECT_FACTOR ** Math.max(0, this._wsReconnectAttempt - 1)),
      WS_RECONNECT_MAX_MS,
    );
    const jitter = Math.floor(Math.random() * 2000);
    const retryMs = Math.floor(backoff + jitter);

    this.log(`[ws] reconnect scheduled in ${retryMs}ms (reason=${reason}, attempt=${this._wsReconnectAttempt}, platform=${this._wsPlatform})`);

    this._wsReconnectTimer = this.homey.setTimeout(() => {
      this._wsReconnectTimer = null;
      this._diag.wsReconnects += 1;
      this._connect();
    }, retryMs);
  }

  _hardResetWs(reason = 'streak') {
    this._diag.wsHardResets += 1;
    this.log(`[ws] hard reset websocket (reason=${reason})`);

    try {
      if (this._ws) this._ws.terminate();
    } catch (_) {}
    this._ws = null;
    this._connected = false;

    if (this._wsPingTimer) {
      clearInterval(this._wsPingTimer);
      this._wsPingTimer = null;
    }

    if (this._wsReconnectTimer) {
      clearTimeout(this._wsReconnectTimer);
      this._wsReconnectTimer = null;
    }

    this._wsReconnectAttempt = 0;
    this._scheduleReconnect('hard-reset');
  }

  async _wsWatchdog() {
    if (!this._monitoringEnabled) return;

    const now = Date.now();
    const readyState = this._ws ? this._ws.readyState : -1;
    const idleSec = this._lastWsMessageAt ? Math.round((now - this._lastWsMessageAt) / 1000) : -1;

    if (now - this._lastWsHealthLogAt > 120000) {
      this._lastWsHealthLogAt = now;
      this.log(`[ws] health state=${readyState} connected=${this._connected} idleSec=${idleSec} lastType=${this._lastWsEventType}`);
    }

    const shouldFallbackPoll = (!this._ws || this._ws.readyState !== WebSocket.OPEN)
      || (this._lastWsMessageAt && (now - this._lastWsMessageAt > WS_STALE_TIMEOUT_MS));

    if (shouldFallbackPoll && now - this._lastFallbackPollAt > OREF_FALLBACK_POLL_MS) {
      this._lastFallbackPollAt = now;
      await this._runFallbackPoll();
    }

    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;

    const idleMs = this._lastWsMessageAt ? (now - this._lastWsMessageAt) : Infinity;
    if (idleMs > WS_STALE_TIMEOUT_MS) {
      this.log(`[ws] stale connection detected (${Math.round(idleMs / 1000)}s idle), reconnecting`);
      this._wsDisconnectStreak += 1;
      try {
        this._ws.terminate();
      } catch (_) {}
      this._scheduleReconnect('stale-watchdog');
    }
  }

  _extractAreasFromOrefRecord(record) {
    const data = record?.data;
    if (Array.isArray(data)) return data.map((x) => String(x));
    if (typeof data === 'string') {
      return data.split(',').map((x) => String(x).trim()).filter(Boolean);
    }
    return [];
  }

  _formatTimestamp(ts, lang) {
    const effectiveLang = this._getEffectiveLanguage(lang);
    return new Date(ts || Date.now()).toLocaleString(effectiveLang === 'he' ? 'he-IL' : 'en-US', {
      hour12: false,
      timeZone: APP_TIMEZONE,
    });
  }

  _createEvent(fields) {
    return {
      id: fields.id,
      notificationId: fields.notificationId || null,
      source: fields.source || 'unknown',
      type: fields.type,
      title: fields.title,
      category: fields.category,
      severity: fields.severity,
      areas: fields.areas,
      threatId: fields.threatId,
      threatKey: fields.threatKey,
      threatNameHe: fields.threatNameHe,
      threatNameEn: fields.threatNameEn,
      time: fields.time || Date.now(),
    };
  }

  async _maybeInferAllClearFromFallback(hasPrimaryMatch) {
    if (hasPrimaryMatch) return;
    if (!this._active || this._activeType !== 'primary') return;

    const lastSeenAt = Number(this._activePrimaryLastSeenAt || 0);
    if (!lastSeenAt) return;

    const elapsed = Date.now() - lastSeenAt;
    if (elapsed < INFER_ALL_CLEAR_GRACE_MS) return;

    const lastAreas = Array.isArray(this._lastEvent?.areas) ? this._lastEvent.areas : [];
    const event = this._createEvent({
      id: `INFER-END-${Date.now()}`,
      source: 'inferred',
      type: 'all-clear',
      title: 'All clear (inferred)',
      category: 'all-clear',
      severity: SEVERITY_BY_CATEGORY['all-clear'],
      areas: lastAreas,
      threatId: 8,
      threatKey: 'all_clear',
      threatNameHe: 'סיום אירוע',
      threatNameEn: 'All clear',
      time: Date.now(),
    });

    this._active = false;
    this._activeType = null;
    this._activePrimaryLastSeenAt = 0;
    this._diag.inferredAllClears += 1;
    await this._emitEvent(event, this._triggerAllClear);
  }

  async _runFallbackPoll() {
    this._diag.fallbackPollRuns += 1;
    try {
      const res = await fetch(OREF_ALERTS_URL, {
        headers: {
          'user-agent': 'Mozilla/5.0',
          accept: 'application/json,text/plain,*/*',
        },
      });
      if (!res.ok) return;

      const text = (await res.text()).split('\0').join('').trim();
      if (!text) return;

      let payload;
      try {
        payload = JSON.parse(text);
      } catch (_) {
        return;
      }

      let records = [];
      if (Array.isArray(payload)) {
        records = payload;
      } else if (Array.isArray(payload?.data)) {
        records = payload.data;
      }
      let hasPrimaryMatch = false;

      for (const rec of records) {
        const threatId = Number(rec?.cat || rec?.threat || 0);
        const threat = THREAT_TYPES[threatId] || THREAT_TYPES[0];
        const areasByName = this._extractAreasFromOrefRecord(rec);
        const matched = this._filterAreasByNames(areasByName);
        if (!matched.length) continue;

        const eventType = threat.category === 'primary' ? 'primary' : 'other';
        if (eventType === 'primary') hasPrimaryMatch = true;

        const event = this._createEvent({
          id: `OREF-${rec?.id || rec?.alertId || Date.now()}-${threatId}`,
          notificationId: rec?.id || rec?.alertId || null,
          source: 'oref-fallback',
          type: eventType,
          title: rec?.title || rec?.titleHe || threat.en,
          category: threat.category,
          severity: SEVERITY_BY_CATEGORY[threat.category],
          areas: matched,
          threatId,
          threatKey: threat.key,
          threatNameHe: threat.he,
          threatNameEn: threat.en,
          time: Date.now(),
        });

        this._active = true;
        this._activeType = eventType;
        if (eventType === 'primary') this._activePrimaryLastSeenAt = Date.now();
        await this._emitEvent(event, this._triggerRedAlert);
        this._diag.fallbackPollHits += 1;
      }

      await this._maybeInferAllClearFromFallback(hasPrimaryMatch);
      this._lastFallbackSourceAt = Date.now();
    } catch (err) {
      this._diag.lastError = String(err?.message || err);
    }
  }

  _wsUrl(platform) {
    return `${WS_BASE_URL}?platform=${platform}`;
  }

  _alternatePlatform(platform) {
    return platform === 'WEB' ? 'ANDROID' : 'WEB';
  }

  _maybeSwitchPlatform(reason = 'auto') {
    if (!this._wsAutoFallback) return false;
    if (this._wsPlatform !== this._wsPreferredPlatform) return false;
    if (this._wsReconnectAttempt < 3) return false;

    this._wsPlatform = this._alternatePlatform(this._wsPlatform);
    this._wsFallbackActive = true;
    this._diag.wsPlatformSwitches += 1;
    this.log(`[ws] auto-switched platform to ${this._wsPlatform} (reason=${reason})`);
    return true;
  }

  _connect() {
    if (!this._monitoringEnabled) {
      this.log('Monitoring disabled, websocket connect skipped');
      return;
    }

    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = this._wsUrl(this._wsPlatform);
    this.log(`Opening Tzeva Adom websocket (platform=${this._wsPlatform})...`);
    this._ws = new WebSocket(wsUrl, {
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
      this._wsDisconnectStreak = 0;
      this._wsReconnectAttempt = 0;
      this._lastWsMessageAt = Date.now();
      this.log(`Connected to Tzeva Adom websocket (platform=${this._wsPlatform})`);

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
      this._wsDisconnectStreak += 1;

      if (this._wsPingTimer) {
        clearInterval(this._wsPingTimer);
        this._wsPingTimer = null;
      }

      if (this._wsDisconnectStreak >= WS_MAX_STREAK_BEFORE_HARD_RESET) {
        this._hardResetWs('disconnect-streak');
        return;
      }

      this._scheduleReconnect('close');
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

      const wsNotificationId = message.data.notificationId ?? message.data.alertId ?? message.data.id ?? null;

      const event = this._createEvent({
        id: `ALERT-${wsNotificationId || Date.now()}`,
        notificationId: wsNotificationId,
        source: 'tzevaadom-ws',
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
      });

      this._active = true;
      this._activeType = eventType;
      if (eventType === 'primary') this._activePrimaryLastSeenAt = Date.now();
      await this._emitEvent(event, this._triggerRedAlert);
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

        const wsNotificationId = message.data.notificationId ?? message.data.alertId ?? message.data.id ?? null;

        const event = this._createEvent({
          id: `PRE-${wsNotificationId || Date.now()}`,
          notificationId: wsNotificationId,
          source: 'tzevaadom-ws',
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
        });
        await this._emitEvent(event, this._triggerPreAlert);
        return;
      }

      if (instructionType === SYSTEM_TYPE.END_ALERT) {
        const wsNotificationId = message.data.notificationId ?? message.data.alertId ?? message.data.id ?? null;

        const event = this._createEvent({
          id: `END-${wsNotificationId || Date.now()}`,
          notificationId: wsNotificationId,
          source: 'tzevaadom-ws',
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
        });
        this._active = false;
        this._activeType = null;
        this._activePrimaryLastSeenAt = 0;
        await this._emitEvent(event, this._triggerAllClear);
      }
    }
  }

  _filterAreasByNames(areas) {
    const hasNationwideName = (areas || []).some((name) => {
      const normalized = this._normalizeAreaName(name);
      return NATIONWIDE_ALIASES.some((x) => normalized === this._normalizeAreaName(x)) || this._normalizedCityToId.get(normalized) === NATIONWIDE_CITY_ID;
    });

    if (!this._selectedCityIds.length) {
      if (hasNationwideName) {
        this._diag.nationwideMatches += 1;
        return ['Nationwide'];
      }
      return areas;
    }

    const selected = new Set(this._selectedCityIds);

    if (hasNationwideName) {
      this._diag.nationwideMatches += 1;
      return this._selectedCityIds.map((id) => this._cityIdToName.get(id) || String(id));
    }

    return areas.filter((name) => {
      const raw = String(name || '').trim();
      const direct = this._cityNameToId.get(raw);
      if (selected.has(direct)) return true;

      const normalized = this._normalizeAreaName(raw);
      const normalizedId = this._normalizedCityToId.get(normalized);
      const matched = selected.has(normalizedId);

      if (!matched && normalizedId === undefined) {
        this._diag.unknownAreaMisses += 1;
      }

      return matched;
    });
  }

  _filterAreasByIds(areaIds) {
    const ids = areaIds.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
    const nationwide = ids.includes(NATIONWIDE_CITY_ID);

    if (!this._selectedCityIds.length) {
      if (nationwide) {
        this._diag.nationwideMatches += 1;
        return ['Nationwide'];
      }
      return ids.map((id) => this._cityIdToName.get(id) || String(id));
    }

    if (nationwide) {
      this._diag.nationwideMatches += 1;
      return this._selectedCityIds.map((id) => this._cityIdToName.get(id) || String(id));
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

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: APP_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    const nowMinutes = (hour * 60) + minute;

    const start = this._timeToMinutes(this._quietHours.start, 23 * 60);
    const end = this._timeToMinutes(this._quietHours.end, 6 * 60);

    if (start <= end) return nowMinutes >= start && nowMinutes <= end;
    return nowMinutes >= start || nowMinutes <= end;
  }

  _getEffectiveLanguage(lang) {
    if (lang === 'he' || lang === 'en') return lang;
    return this._settingsLang === 'en' ? 'en' : 'he';
  }

  _getThreatDisplayName(event, lang) {
    const effectiveLang = this._getEffectiveLanguage(lang);
    if (effectiveLang === 'en') {
      return event?.threatNameEn || event?.threatNameHe || event?.title || '-';
    }
    return event?.threatNameHe || event?.threatNameEn || event?.title || '-';
  }

  _getCategoryDisplay(event, lang) {
    const effectiveLang = this._getEffectiveLanguage(lang);
    const key = event?.category || 'other';
    const labels = {
      primary: { he: 'ראשית', en: 'Primary' },
      'pre-alert': { he: 'מקדימה', en: 'Pre-alert' },
      'all-clear': { he: 'סיום אירוע', en: 'All-clear' },
      other: { he: 'אחר', en: 'Other' },
      test: { he: 'בדיקה', en: 'Test' },
    };
    const mapped = labels[key] || { he: key, en: key };
    return effectiveLang === 'en' ? mapped.en : mapped.he;
  }

  _getLocalizedAreas(event, lang) {
    const effectiveLang = this._getEffectiveLanguage(lang);
    const rawAreas = Array.isArray(event?.areas) ? event.areas : [];

    return rawAreas.map((name) => {
      const raw = String(name || '').trim();
      const normalizedId = this._normalizedCityToId.get(this._normalizeAreaName(raw));
      if (Number.isFinite(normalizedId)) {
        const meta = this._cityIdToMeta.get(normalizedId);
        if (meta) {
          return effectiveLang === 'en' ? (meta.en || meta.he || raw) : (meta.he || meta.en || raw);
        }
      }
      return raw;
    });
  }

  _buildDedupeAreaKey(event) {
    const rawAreas = Array.isArray(event?.areas) ? event.areas : [];
    if (!rawAreas.length) return 'none';

    const zoneKeys = new Set();

    for (const areaName of rawAreas) {
      const raw = String(areaName || '').trim();
      if (!raw) continue;

      const cityId = this._normalizedCityToId.get(this._normalizeAreaName(raw));
      if (Number.isFinite(cityId)) {
        const cityMeta = this._cityIdToMeta.get(cityId);
        if (Number.isFinite(cityMeta?.areaId)) {
          zoneKeys.add(`areaId:${cityMeta.areaId}`);
          continue;
        }
      }

      const areaMeta = this._resolveAreaMetadata(raw);
      if (areaMeta?.area) {
        zoneKeys.add(`area:${this._normalizeAreaName(areaMeta.area)}`);
      } else if (areaMeta?.d) {
        zoneKeys.add(`district:${this._normalizeAreaName(areaMeta.d)}`);
      } else {
        zoneKeys.add(`city:${this._normalizeAreaName(raw)}`);
      }
    }

    if (!zoneKeys.size) return 'none';
    return [...zoneKeys].sort().join('|');
  }

  _getEventAreaInsights(event) {
    const rawAreas = Array.isArray(event?.areas) ? event.areas : [];
    const resolved = rawAreas
      .map((name) => ({ name: String(name || '').trim(), meta: this._resolveAreaMetadata(name) }))
      .filter((x) => x.meta);

    const migunValues = resolved
      .map((x) => Number(x.meta?.m))
      .filter((n) => Number.isFinite(n));

    const migunTimeSec = migunValues.length ? Math.min(...migunValues) : null;
    const primaryArea = resolved[0]?.meta?.area || rawAreas[0] || '';
    const district = resolved[0]?.meta?.d || '';

    return {
      migunTimeSec,
      district,
      primaryArea,
      areasCount: rawAreas.length,
    };
  }

  _buildAlertMessage(event, mode = 'full', lang) {
    const effectiveLang = this._getEffectiveLanguage(lang);
    if (!event) {
      return effectiveLang === 'he' ? 'אין התראות עדיין.' : 'No alerts yet.';
    }

    const ts = this._formatTimestamp(event.time, effectiveLang);
    const threat = this._getThreatDisplayName(event, effectiveLang);
    const areas = this._getLocalizedAreas(event, effectiveLang).join(', ') || '-';
    const severityKey = event.severity || '-';
    const severityLabel = SEVERITY_LABELS[severityKey] || { he: severityKey, en: severityKey };
    const severityText = effectiveLang === 'he' ? severityLabel.he : severityLabel.en;
    const insights = this._getEventAreaInsights(event);
    let migunText = null;
    if (Number.isFinite(insights.migunTimeSec)) {
      migunText = effectiveLang === 'he'
        ? `${insights.migunTimeSec} שנ׳ למרחב מוגן`
        : `${insights.migunTimeSec}s to shelter`;
    }

    const notificationId = this._extractNotificationId(event?.notificationId);
    const sourceLabels = {
      'tzevaadom-ws': { he: 'צבע אדום (WebSocket)', en: 'TzevaAdom (WebSocket)' },
      'oref-fallback': { he: 'פיקוד העורף (Fallback)', en: 'Home Front Command (Fallback)' },
      inferred: { he: 'מוסק', en: 'Inferred' },
      unknown: { he: 'לא ידוע', en: 'Unknown' },
    };
    const sourceLabel = (sourceLabels[event?.source] || sourceLabels.unknown)[effectiveLang === 'he' ? 'he' : 'en'];

    if (mode === 'full') {
      if (effectiveLang === 'he') {
        const lines = [
          `🚨 התראה: ${threat}`,
          `אזורים: ${areas}`,
        ];
        if (insights.district) lines.push(`מחוז: ${insights.district}`);
        lines.push(`קטגוריה: ${this._getCategoryDisplay(event, 'he')}`);
        lines.push(`חומרה: ${severityText}`);
        if (migunText) lines.push(`זמן למיגון: ${insights.migunTimeSec} שניות`);
        lines.push(`זמן: ${ts}`);
        lines.push(`מקור: ${sourceLabel}`);
        return lines.join('\n');
      }

      const lines = [
        `🚨 Alert: ${threat}`,
        `Areas: ${areas}`,
      ];
      if (insights.district) lines.push(`District: ${insights.district}`);
      lines.push(`Category: ${this._getCategoryDisplay(event, 'en')}`);
      lines.push(`Severity: ${severityText}`);
      if (migunText) lines.push(`Shelter time: ${insights.migunTimeSec}s`);
      lines.push(`Time: ${ts}`);
      lines.push(`Source: ${sourceLabel}`);
      return lines.join('\n');
    }

    const category = this._getCategoryDisplay(event, effectiveLang);
    const areaCount = insights.areasCount || 0;
    const idPart = notificationId ? (effectiveLang === 'he' ? ` | מזהה: ${notificationId}` : ` | ID: ${notificationId}`) : '';
    const districtPart = insights.district ? (effectiveLang === 'he' ? ` | מחוז: ${insights.district}` : ` | District: ${insights.district}`) : '';
    const sourcePart = effectiveLang === 'he' ? ` | מקור: ${sourceLabel}` : ` | Source: ${sourceLabel}`;

    return `🚨 ${threat} | ${category} | ${areas} (${areaCount}) | ${severityText}${sourcePart}${migunText ? ` | ${migunText}` : ''}${districtPart}${idPart} | ${ts}`;
  }

  async _updateMessageToken(event, mode = 'full', lang) {
    if (!this._lastAlertMessageToken) return;
    const message = this._buildAlertMessage(event, mode, lang);
    await this._lastAlertMessageToken.setValue(message);
  }

  _extractNotificationId(raw) {
    if (raw === null || raw === undefined) return null;
    const str = String(raw).trim();
    if (!str) return null;
    const digits = str.match(/\d+/g)?.join('') || '';
    return digits.length ? digits : null;
  }

  _buildAlertLink(event, source = 'tzevaadom') {
    if (source === 'tzevaadom') {
      const notificationId = this._extractNotificationId(event?.notificationId);
      if (notificationId) {
        return `https://www.tzevaadom.co.il/alerts/${notificationId}`;
      }
      return 'https://www.tzevaadom.co.il/';
    }

    // official source default
    return 'https://www.oref.org.il/eng';
  }

  async _updateLinkToken(event, source = 'tzevaadom') {
    if (!this._lastAlertLinkToken) return;
    const link = this._buildAlertLink(event, source);
    await this._lastAlertLinkToken.setValue(link);
  }

  async _emitEvent(event, card) {
    const now = Date.now();
    const throttleMs = Number(this._throttleByTypeMs[event.type] || 0);
    const dedupeWindowMs = Math.max(DEDUPE_MIN_WINDOW_MS, throttleMs);

    const areaKey = this._buildDedupeAreaKey(event);
    const bucket = Math.floor((event.time || now) / 60000);

    const dedupeKey = `${event.type}:${event.id}`;
    const dedupeSignature = `${event.type}:${event.threatId ?? 'na'}:${areaKey}:${bucket}`;

    const lastById = this._dedupe.get(dedupeKey) || 0;
    const lastBySig = this._dedupe.get(dedupeSignature) || 0;
    if ((now - lastById < dedupeWindowMs) || (now - lastBySig < dedupeWindowMs)) {
      this._diag.dedupeDrops += 1;
      return;
    }

    this._dedupe.set(dedupeKey, now);
    this._dedupe.set(dedupeSignature, now);

    this._lastEvent = event;
    this._lastFlowEvent = event;
    this._history.unshift(event);
    if (this._history.length > MAX_HISTORY) this._history.length = MAX_HISTORY;

    await this._updateMessageToken(event, 'full');
    await this._updateLinkToken(event, 'tzevaadom');

    const lang = this._getEffectiveLanguage();
    const localizedAreas = this._getLocalizedAreas(event, lang);
    const insights = this._getEventAreaInsights(event);
    const tokens = {
      title: this._getThreatDisplayName(event, lang),
      category: this._getCategoryDisplay(event, lang),
      areas: localizedAreas.join(', '),
      timestamp: this._formatTimestamp(event.time, lang),
      severity: lang === 'he'
        ? ((SEVERITY_LABELS[event.severity || '-'] || { he: event.severity || '-' }).he)
        : ((SEVERITY_LABELS[event.severity || '-'] || { en: event.severity || '-' }).en),
      threat_id: String(event.threatId ?? ''),
      threat_key: event.threatKey || '',
      threat_name: this._getThreatDisplayName(event, lang),
      migun_time_sec: Number.isFinite(insights.migunTimeSec) ? String(insights.migunTimeSec) : '',
      district: insights.district || '',
      areas_count: String(insights.areasCount || localizedAreas.length || 0),
      primary_area: localizedAreas[0] || insights.primaryArea || '',
      alert_message: this._buildAlertMessage(event, 'full', lang),
      alert_link: this._buildAlertLink(event, 'tzevaadom'),
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

    await this._persistRuntimeState();
  }

  _restoreRuntimeState() {
    try {
      const state = this.homey.settings.get(RUNTIME_STATE_KEY);
      if (!state || typeof state !== 'object') return;

      const now = Date.now();
      const history = Array.isArray(state.history) ? state.history : [];
      this._history = history
        .filter((e) => Number.isFinite(e?.time) && (now - e.time) <= HISTORY_TTL_MS)
        .slice(0, MAX_HISTORY);

      const lastEvent = state.lastEvent && Number.isFinite(state.lastEvent?.time) ? state.lastEvent : null;
      this._lastEvent = lastEvent;
      this._lastFlowEvent = lastEvent;

      this._active = !!state.active;
      this._activeType = state.activeType || null;
      this._activePrimaryLastSeenAt = Number(state.activePrimaryLastSeenAt || 0);
    } catch (err) {
      this.error('Failed restoring runtime state', err);
    }
  }

  async _persistRuntimeState() {
    try {
      await this.homey.settings.set(RUNTIME_STATE_KEY, {
        active: this._active,
        activeType: this._activeType,
        activePrimaryLastSeenAt: this._activePrimaryLastSeenAt,
        lastEvent: this._lastEvent,
        history: this._history.slice(0, MAX_HISTORY),
        savedAt: Date.now(),
      });
    } catch (err) {
      this._diag.lastError = String(err?.message || err);
    }
  }

  _cleanupHistory() {
    const cutoff = Date.now() - HISTORY_TTL_MS;
    const before = this._history.length;
    this._history = this._history.filter((e) => Number.isFinite(e?.time) && e.time >= cutoff).slice(0, MAX_HISTORY);
    if (this._lastEvent && (!Number.isFinite(this._lastEvent?.time) || this._lastEvent.time < cutoff)) {
      this._lastEvent = null;
      this._lastFlowEvent = null;
    }
    if (this._history.length !== before) {
      this._persistRuntimeState();
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
        platform: this._wsPlatform,
        preferredPlatform: this._wsPreferredPlatform,
        autoFallback: this._wsAutoFallback,
        fallbackActive: this._wsFallbackActive,
        lastMessageAt: this._lastWsMessageAt || null,
        lastPingAt: this._lastWsPingAt || null,
        lastEventType: this._lastWsEventType,
        lastFallbackPollAt: this._lastFallbackPollAt || null,
        lastFallbackSourceAt: this._lastFallbackSourceAt || null,
      },
      selectedCityIdsCount: this._selectedCityIds.length,
      normalizationIndexSize: this._normalizedCityToId.size,
      metadata: {
        areaEntries: this._areaMetaByName.size,
        normalizedEntries: this._areaMetaByNormalized.size,
      },
      activePrimaryLastSeenAt: this._activePrimaryLastSeenAt || null,
      stats: { ...this._diag },
      lastEventId: this._lastEvent?.id || null,
      lastEventType: this._lastEvent?.type || null,
      quietHours: this._quietHours,
      throttleByTypeMs: this._throttleByTypeMs,
      now: Date.now(),
    };
  }

  getPublicState() {
    const lang = this._getEffectiveLanguage();
    const now = Date.now();
    const lastWsAt = Number(this._lastWsMessageAt || 0);
    const lastFallbackAt = Number(this._lastFallbackSourceAt || 0);

    let ingestSource = 'idle';
    if (this._connected && lastWsAt && (now - lastWsAt) < WS_STALE_TIMEOUT_MS) {
      ingestSource = 'ws';
    } else if (lastFallbackAt && (now - lastFallbackAt) < (OREF_FALLBACK_POLL_MS * 3)) {
      ingestSource = 'fallback';
    }

    const toDisplayEvent = (event) => {
      if (!event) return null;
      return {
        ...event,
        threatName: this._getThreatDisplayName(event, lang),
        categoryLabel: this._getCategoryDisplay(event, lang),
        message: this._buildAlertMessage(event, 'full', lang),
      };
    };

    return {
      language: lang,
      ingestSource,
      monitoringEnabled: this._monitoringEnabled,
      connected: this._connected,
      active: this._active,
      activeType: this._activeType,
      selectedCityIds: this._selectedCityIds,
      selectedCities: this._selectedCityIds.map((id) => {
        const meta = this._cityIdToMeta.get(id);
        if (!meta) return String(id);
        return lang === 'en' ? (meta.en || meta.he || String(id)) : (meta.he || meta.en || String(id));
      }),
      quietHours: this._quietHours,
      throttleByTypeMs: this._throttleByTypeMs,
      lastEvent: toDisplayEvent(this._lastEvent),
      history: this._history.slice(0, 10).map(toDisplayEvent),
      threatTypes: this.getThreatTypes(),
      message: this._buildAlertMessage(this._lastEvent, 'full', lang),
      linkOref: this._buildAlertLink(this._lastEvent, 'oref'),
      linkTzevaadom: this._buildAlertLink(this._lastEvent, 'tzevaadom'),
      diagnostics: this.getDiagnostics(),
    };
  }

  getThreatTypes() {
    const lang = this._getEffectiveLanguage();
    return Object.entries(THREAT_TYPES).map(([id, t]) => ({
      id: Number(id),
      key: t.key,
      label: lang === 'en' ? t.en : t.he,
      category: t.category,
    }));
  }

  getCities(limit = 500) {
    const lang = this._getEffectiveLanguage();
    const entries = [];
    for (const [id, meta] of this._cityIdToMeta.entries()) {
      const localizedName = lang === 'en' ? (meta.en || meta.he) : (meta.he || meta.en);
      entries.push({
        id, name: localizedName, he: meta.he, en: meta.en,
      });
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

    if (!this._monitoringEnabled) {
      if (this._ws) {
        this._ws.close();
        this._connected = false;
      }
      if (this._wsReconnectTimer) {
        clearTimeout(this._wsReconnectTimer);
        this._wsReconnectTimer = null;
      }
      this._wsReconnectAttempt = 0;
      this._wsDisconnectStreak = 0;
      this._wsPlatform = this._wsPreferredPlatform;
      this._wsFallbackActive = false;
      this._activePrimaryLastSeenAt = 0;
    }

    await this._persistRuntimeState();
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
