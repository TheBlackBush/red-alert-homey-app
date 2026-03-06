'use strict';

module.exports = {
  async getState({ homey }) {
    return homey.app.getPublicState();
  },

  async setMonitoring({ homey, body }) {
    const enabled = !!body?.enabled;
    const monitoringEnabled = await homey.app.setMonitoringEnabled(enabled);
    return { monitoringEnabled };
  },

  async setCities({ homey, body }) {
    const cities = Array.isArray(body?.cities) ? body.cities : [];
    const selectedCities = await homey.app.setCities(cities);
    return { selectedCities };
  },
};
