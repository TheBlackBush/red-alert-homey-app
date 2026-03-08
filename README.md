# red-alert-homey-app

Homey app (SDK v3) for Israeli civil defense alerts using **Flows + Widget** (no devices).

## Features
- Real-time WebSocket listener (`ws.tzevaadom.co.il`)
- Threat-type mapping (threat ID/key/hebrew/english) exposed to flows and widget
- App settings page for monitoring, cities, quiet hours and throttle policies
- Flow triggers:
  - `red_alert_received`
  - `pre_alert_received`
  - `all_clear_received`
- Flow conditions:
  - `is_monitoring_enabled`
  - `is_alert_active`
- Flow actions:
  - `set_monitoring_enabled`
  - `test_trigger`
  - `refresh_summary_token`
  - `build_message_template` (short/full, he/en)
  - `build_alert_link` (oref/tzevaadom)
- Flow tokens:
  - `last_alert_summary`
  - `last_alert_message`
  - `last_alert_link`
- Dashboard widget for status and quick toggle

## Area Metadata Build
`data/area_metadata.json` is a generated data file (used at runtime by `app.js`).

- The generator script is: `scripts/build-area-metadata.js`
- Run manually when you need to refresh/update area metadata:
  - `npm run build:area-metadata`
- Runtime behavior:
  - The app **does not** execute the generator automatically.
  - On startup, it only reads the generated `data/area_metadata.json`.

## Notes
- This is a community integration and **not** an official warning system replacement.
- Keep official emergency channels enabled at all times.
