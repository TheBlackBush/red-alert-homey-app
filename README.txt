Red Alert Israel brings real-time civil defense alerts into Homey and lets you automate your safety routines.

What this app provides:
- Flow triggers for:
  - Red alert
  - Pre-alert
  - All-clear
- Flow conditions for monitoring/active state
- Flow actions for monitoring control, summary refresh, and alert link/message helpers
- Dashboard widget with live status and quick monitor toggle

How to configure after install:
1) Open the app settings in Homey.
2) Enable monitoring.
3) Choose app language (Hebrew/English) in settings.
4) Choose your cities (or leave empty to match all cities).
5) Configure quiet hours (optional, applies to pre-alert behavior).
6) Configure throttle values per event type (optional).
7) Save settings.

Recommended first Flow setup:
- Trigger: "red_alert_received"
- Actions: send push/WhatsApp/Telegram, turn on lights, stop/mute media, and run your emergency scene.

Flow Tokens: how they work and how to configure them

Available tokens (global):
- `last_alert_summary`:
  - A compact summary line built from the last event.
  - Updated automatically on every incoming event.
- `last_alert_message`:
  - A formatted message text for notifications.
  - Updated automatically on every incoming event (default mode: short).
- `last_alert_link`:
  - Link to alert details.
  - Updated automatically on every incoming event (default source: tzevaadom).

How to use tokens in your Flows:
1) Create/open a Flow with trigger (for example `red_alert_received`).
2) In your notification action (Push/WhatsApp/Telegram/etc.), insert token chips such as:
   - `[[last_alert_message]]`
   - `[[last_alert_link]]`
   - or use per-trigger tokens (`areas`, `severity`, `timestamp`, etc.).
3) Save and test.

Token-related action cards:
- `build_message_template`:
  - Purpose: Rebuild `last_alert_message` from the last event.
  - Argument: `mode` = `short` or `full`.
  - Use case: You want a full detailed message before sending.
- `build_alert_link`:
  - Purpose: Rebuild `last_alert_link` from the last event.
  - Argument: `source` = `tzevaadom` or `oref`.
  - Use case: Force link source before sending.
- `refresh_summary_token`:
  - Purpose: Rebuild `last_alert_summary` and `last_alert_message` from the last event.
  - Note: currently refreshes message in `short` mode.

Recommended pattern for full message + custom link:
1) Action: `build_message_template` with `mode=full`
2) Action: `build_alert_link` with desired `source`
3) Action: Send notification using `[[last_alert_message]]` + `[[last_alert_link]]`

Notes:
- Token actions do not fetch a new alert from the server; they rebuild tokens from the last stored event.
- If no event has been received yet, token values may be empty/default.

Important:
- This is a community integration and not an official warning system.
- Always keep official emergency channels active.
