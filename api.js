'use strict';

module.exports = {
  async cities({ homey }) {
    return {
      cities: homey.app.getCities(5000),
    };
  },

  async diagnostics({ homey }) {
    return homey.app.getDiagnostics();
  },
};
