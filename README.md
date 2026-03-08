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

## Area/Cities Metadata Sync
Generated files used by the app:
- `data/area_metadata.json`
- `data/cities.json`
- `data/areas.he.json`
- `data/areas.en.json`
- `data/alarm_instructions.he.json`
- `data/alarm_instructions.en.json`

Unified JS sync script:
- `scripts/update-areas-from-network.js`

Commands:
- Check only (no file changes): `npm run check:area-metadata`
- Apply update: `npm run sync:area-metadata`

### Manual update flow (recommended)
1. Review changes first:
   - `npm run check:area-metadata`
2. If output looks good, apply:
   - `npm run sync:area-metadata`
3. (Optional) validate app package:
   - `npm run validate`

> Note: metadata is updated only when these commands are run (not automatically at runtime).

Data sources used by the sync:
- Districts/cities Hebrew: `GetDistricts.aspx?lang=he`
- Districts/cities English: `GetDistricts.aspx?lang=en`
- Per-city instructions Hebrew: `GetAlarmInstructions.aspx?lang=he&from=1&cityid=<id>`
- Per-city instructions English: `GetAlarmInstructions.aspx?lang=en&from=1&cityid=<id>`

What it does:
- Pulls latest areas/cities in HE+EN from Oref
- Filters deprecated/aggregate labels
- Rebuilds `cities.json` and bilingual area lists
- Rebuilds `area_metadata.json` (`m`, `d`, plus EN labels metadata)
- Fetches and stores per-city alarm instructions in HE+EN

Runtime behavior:
- The app **does not** execute sync automatically.
- On startup, it reads the generated data files.

## Notes
- This is a community integration and **not** an official warning system replacement.
- Keep official emergency channels enabled at all times.
