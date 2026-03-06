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
    const selectedCityIds = await homey.app.setCities(cities);
    return { selectedCityIds };
  },

  async setPolicies({ homey, body }) {
    return homey.app.setPolicies({
      quietHours: body?.quietHours,
      throttleByTypeMs: body?.throttleByTypeMs,
    });
  },

  async getThreatTypes({ homey }) {
    return homey.app.getThreatTypes();
  },

  async getCities({ homey }) {
    return homey.app.getCities(500);
  },
};
