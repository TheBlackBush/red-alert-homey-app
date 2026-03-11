Red Alert Israel brings real-time civil defense alerts into Homey and lets you automate safety routines.

What this app provides:
- Flow triggers for:
  - Red alert
  - Pre-alert
  - All-clear
- Flow conditions for:
  - Monitoring enabled state
  - Alert active state
  - Threat key match
  - Severity match
- Flow actions for:
  - Monitoring on/off
  - Alert message rebuild
  - Alert link rebuild
- Dashboard widget with live status and quick monitor toggle

How to configure after install:
1) Open the app settings in Homey.
2) Enable monitoring.
3) Choose app language (Hebrew/English).
4) Choose your cities (or leave empty to match all cities).
5) Configure quiet hours (optional, affects pre-alert behavior).
6) Configure throttle values per event type (optional).
7) Save settings.

Recommended first Flow setup:
- Trigger: **Red alert received**
- Actions: send push/WhatsApp/Telegram, turn on lights, mute media, run emergency scene.

Flow tokens: how they work

Available global tokens:
- **Last alert message**
  - Formatted notification text based on the last event.
  - Updated automatically on every incoming event.
  - Includes: threat, areas, category, severity, time, source, and alert link.
- **Last alert link**
  - Link to the alert details page.
  - Updated automatically on every incoming event.
  - TzevaAdom link resolution priority:
    1) latest matching id from `https://api.tzevaadom.co.il/alerts-history`
    2) fallback to incoming `notificationId`
    3) fallback to `https://www.tzevaadom.co.il/`

How to use tokens in Flows:
1) Create/open a Flow with a trigger (for example **Red alert received**).
2) In your notification action (Push/WhatsApp/Telegram/etc.), insert token chips such as:
   - **Last alert message**
   - **Last alert link**
   - or trigger tokens like **areas**, **severity**, **timestamp**.
3) Save and test.

Token-related action cards:
- **Build alert message template**
  - Purpose: Rebuild **Last alert message** from the last event.
  - Argument: **Mode** = **Full** or **Short**.
- **Build alert link**
  - Purpose: Rebuild **Last alert link** from the last event.
  - Argument: **Source** = **Tzeva Adom** or **Home Front Command (Oref)**.
- **Set monitoring enabled**
  - Purpose: Turn monitoring on or off from a Flow.

Recommended pattern for full message + explicit link source:
1) Action: **Build alert message template** with **Mode = Full**
2) Action: **Build alert link** with desired **Source**
3) Action: Send notification using token chips **Last alert message** + **Last alert link**

Notes:
- Token actions rebuild values from the last stored event; they do not fetch a new alert.
- If no event has been received yet, token values may be empty/default.

Important:
- This is a community integration and not an official warning system.
- Always keep official emergency channels active.