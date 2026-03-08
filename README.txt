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

Important:
- This is a community integration and not an official warning system.
- Always keep official emergency channels active.
