'use strict';

const Homey = require('homey');
const WebSocket = require('ws');

const WS_URL = 'wss://ws.tzevaadom.co.il/socket?platform=WEB';
const ORIGIN = 'https://www.tzevaadom.co.il';
const ALERT_DEDUPE_MS = 120000;
const MAX_HISTORY = 30;

const THREAT_ID_TO_CATEGORY = {
  0: 'primary',
  2: 'primary',
  5: 'primary',
  7: 'primary',
};

const SYSTEM_TYPE = {
  PRE_ALERT: 0,
  END_ALERT: 1,
};

class RedAlertApp extends Homey.App {
  async onInit() {
    this._active = false;
    this._connected = false;
    this._lastEvent = null;
    this._history = [];
    this._dedupe = new Map();

    this._loadConfig();
    this._registerCards();
    this._connect();

    this.homey.setInterval(() => this._cleanupDedupe(), 10 * 60 * 1000);

    this.log('Red Alert app initialized');
  }

  _loadConfig() {
    const cities = this.homey.settings.get('cities') || [];
    this._cities = Array.isArray(cities) ? cities.filter(Boolean) : [];
    this._monitoringEnabled = this.homey.settings.get('monitoring_enabled') !== false;
  }

  _registerCards() {
    this._triggerRedAlert = this.homey.flow.getTriggerCard('red_alert_received');
    this._triggerPreAlert = this.homey.flow.getTriggerCard('pre_alert_received');
    this._triggerAllClear = this.homey.flow.getTriggerCard('all_clear_received');

    this.homey.flow.getConditionCard('is_monitoring_enabled')
      .registerRunListener(async () => this._monitoringEnabled);

    this.homey.flow.getConditionCard('is_alert_active')
      .registerRunListener(async () => this._active);

    this.homey.flow.getActionCard('set_monitoring_enabled')
      .registerRunListener(async (args) => {
        this._monitoringEnabled = !!args.enabled;
        await this.homey.settings.set('monitoring_enabled', this._monitoringEnabled);
        return true;
      });

    this.homey.flow.getActionCard('test_trigger')
      .registerRunListener(async (args) => {
        const event = {
          id: `test-${Date.now()}`,
          type: 'test',
          title: args.title || 'Test alert',
          category: 'test',
          areas: [args.area || 'Test Area'],
          time: Date.now(),
        };
        await this._emitEvent(event, this._triggerRedAlert);
        return true;
      });
  }

  _connect() {
    if (!this._monitoringEnabled) return;

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
        const message = JSON.parse(raw.toString());
        await this._handleMessage(message);
      } catch (err) {
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
      const threat = Number(message.data.threat);
      const category = THREAT_ID_TO_CATEGORY[threat];
      if (!category || message.data.isDrill) return;

      const areas = Array.isArray(message.data.cities) ? message.data.cities : [];
      const matched = this._filterAreas(areas);
      if (!matched.length) return;

      const event = {
        id: `ALERT-${message.data.notificationId || Date.now()}`,
        type: 'primary',
        title: 'Red Alert',
        category,
        areas: matched,
        time: Number(message.data.time) * 1000 || Date.now(),
      };

      await this._emitEvent(event, this._triggerRedAlert);
      this._active = true;
      return;
    }

    if (message.type === 'SYSTEM_MESSAGE') {
      const instructionType = Number(message.data.instructionType);
      const areaIds = Array.isArray(message.data.citiesIds) ? message.data.citiesIds : [];
      const areas = areaIds.map((id) => String(id));
      const matched = this._filterAreas(areas, true);
      if (!matched.length) return;

      if (instructionType === SYSTEM_TYPE.PRE_ALERT) {
        const event = {
          id: `PRE-${message.data.notificationId || Date.now()}`,
          type: 'pre-alert',
          title: message.data.titleHe || 'Early warning',
          category: 'pre-alert',
          areas: matched,
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
          areas: matched,
          time: Number(message.data.time) * 1000 || Date.now(),
        };
        await this._emitEvent(event, this._triggerAllClear);
        this._active = false;
      }
    }
  }

  _filterAreas(areas, compareAsStringIds = false) {
    if (!this._cities.length) return areas;

    if (compareAsStringIds) {
      const selected = new Set(this._cities.map((x) => String(x).trim()));
      return areas.filter((a) => selected.has(String(a)));
    }

    const selected = new Set(this._cities.map((x) => String(x).trim()));
    return areas.filter((a) => selected.has(String(a).trim()));
  }

  async _emitEvent(event, card) {
    const now = Date.now();
    const last = this._dedupe.get(event.id) || 0;
    if (now - last < ALERT_DEDUPE_MS) return;
    this._dedupe.set(event.id, now);

    this._lastEvent = event;
    this._history.unshift(event);
    if (this._history.length > MAX_HISTORY) this._history.length = MAX_HISTORY;

    await card.trigger({
      title: event.title,
      category: event.category,
      areas: event.areas.join(', '),
      timestamp: new Date(event.time).toISOString(),
    });
  }

  _cleanupDedupe() {
    const cutoff = Date.now() - ALERT_DEDUPE_MS;
    for (const [key, ts] of this._dedupe.entries()) {
      if (ts < cutoff) this._dedupe.delete(key);
    }
  }

  getPublicState() {
    return {
      monitoringEnabled: this._monitoringEnabled,
      connected: this._connected,
      active: this._active,
      selectedCities: this._cities,
      lastEvent: this._lastEvent,
      history: this._history,
    };
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
    this._cities = Array.isArray(cities) ? cities.map((x) => String(x).trim()).filter(Boolean) : [];
    await this.homey.settings.set('cities', this._cities);
    return this._cities;
  }
}

module.exports = RedAlertApp;
