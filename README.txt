Red Alert Israel brings real-time civil defense alerts into Homey and lets you automate safety routines.

FEATURES
- Real-time alert monitoring
- Flow triggers: Red alert, Pre-alert, All-clear
- Flow conditions: Monitoring enabled, Alert active, Threat key match, Severity match
- Flow actions: Set monitoring enabled, Build alert message, Build alert link
- Dashboard widget with live status and quick monitor toggle

SETUP
1. Open the app settings in Homey.
2. Enable monitoring.
3. Choose app language (Hebrew or English).
4. Choose your cities (or leave empty to match all cities).
5. Configure quiet hours (optional, affects pre-alert behavior).
6. Configure throttle values per event type (optional).
7. Save settings.

RECOMMENDED FIRST FLOW
- Trigger: Red alert received
- Actions: Send push/WhatsApp/Telegram, turn on lights, mute media, run emergency scene.

GLOBAL TOKENS
- Last alert message
  Formatted notification text from the last event.
  Includes threat, areas, category, severity, time, source, and alert link.
- Last alert link
  Link to alert details/history from the last event.

LINK BEHAVIOR
- TzevaAdom source:
  1) Uses latest matching id from https://api.tzevaadom.co.il/alerts-history
  2) If no id found, falls back to https://www.tzevaadom.co.il/
- Oref source (by selected app language):
  Hebrew: https://www.oref.org.il/heb/alerts-history
  English: https://www.oref.org.il/eng/alerts-history

TOKEN ACTION CARDS
- Build alert message template
  Rebuilds Last alert message from the last event.
  Mode: Full or Short.
- Build alert link
  Rebuilds Last alert link from the last event.
  Source: Tzeva Adom or Home Front Command (Oref).
- Set monitoring enabled
  Turns monitoring on or off from a Flow.

NOTES
- Token actions rebuild values from the last stored event. They do not fetch a new alert.
- If no event has been received yet, token values may be empty/default.

IMPORTANT
- This is a community integration and not an official warning system.
- Always keep official emergency channels active.