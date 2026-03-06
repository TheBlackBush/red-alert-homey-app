'use strict';

module.exports = {
  async cities({ homey }) {
    return {
      cities: homey.app.getCities(5000),
    };
  },
};
