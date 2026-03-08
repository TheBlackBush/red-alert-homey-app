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

## Area Metadata Sync
`data/area_metadata.json` is a generated data file (used at runtime by `app.js`).

- Unified JS script: `scripts/update-areas-from-network.js`
- In-project metadata sources (JSON):
  - `data-src/area_to_migun_time.json`
  - `data-src/area_to_district.json`
- Commands:
  - Check only (no file changes): `npm run check:area-metadata`
  - Apply update: `npm run sync:area-metadata`
- What it does:
  - Pulls latest area list from Oref network feed (`GetCitiesMix.aspx`)
  - Filters deprecated/aggregate labels
  - Merges area metadata (`m`, `d`) from existing file and source JSON maps
  - Rebuilds `normalized` map
- Runtime behavior:
  - The app **does not** execute sync automatically.
  - On startup, it only reads `data/area_metadata.json`.

## Notes
- This is a community integration and **not** an official warning system replacement.
- Keep official emergency channels enabled at all times.
