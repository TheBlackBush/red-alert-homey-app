# red-alert-homey-app

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/BuSHari/red-alert-homey-app)](https://github.com/BuSHari/red-alert-homey-app/releases)
[![GitHub last commit](https://img.shields.io/github/last-commit/BuSHari/red-alert-homey-app)](https://github.com/BuSHari/red-alert-homey-app/commits/master)
[![Homey SDK](https://img.shields.io/badge/Homey-SDK%20v3-00AEEF)](https://apps.developer.homey.app/the-basics)

Homey app (SDK v3) for Israeli civil defense alerts using **Flows + Widget** (no devices).

## Features
- Real-time WebSocket listener (`ws.tzevaadom.co.il`) with resilience/fallback behavior
- Threat-type mapping (threat ID/key/hebrew/english) exposed to flows and widget
- App settings page for monitoring, language, cities, quiet hours, and throttle policies
- Flow triggers:
  - `red_alert_received`
  - `pre_alert_received`
  - `all_clear_received`
- Flow conditions:
  - `is_monitoring_enabled`
  - `is_alert_active`
  - `matches_threat_key`
  - `matches_severity`
- Flow actions:
  - `set_monitoring_enabled`
  - `build_message_template` (short/full)
  - `build_alert_link` (oref/tzevaadom)
- Global flow tokens:
  - `last_alert_message`
  - `last_alert_link`
- Alert link generation:
  - TzevaAdom source resolves latest matching `alerts/<id>` via `https://api.tzevaadom.co.il/alerts-history`
  - TzevaAdom fallback is `https://www.tzevaadom.co.il/`
  - Oref source uses language-aware history links:
    - HE: `https://www.oref.org.il/heb/alerts-history`
    - EN: `https://www.oref.org.il/eng/alerts-history`
- Alert message token includes direct alert link in both short and full formats
- Dashboard widget for status and quick toggle

## Area/Cities Metadata Sync
Generated files used by the app:
- `data/area_metadata.json`
- `data/cities.json`

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

What it does:
- Pulls latest areas/cities in HE+EN from Oref
- Filters deprecated/aggregate labels
- Rebuilds `cities.json` (keys by `cityId`; `areas` keys by `areaId`; `countdown` keys by `cityId`)
- Rebuilds `area_metadata.json` (`m`, `d`, plus EN labels metadata)

Runtime behavior:
- The app **does not** execute sync automatically.
- On startup, it reads the generated data files.

## Notes
- This is a community integration and **not** an official warning system replacement.
- Keep official emergency channels enabled at all times.

## ⚠️ Legal Disclaimer / הצהרת אחריות משפטית / إخلاء مسؤولية قانونية

### English
> This software is an independent, community project and is not produced, endorsed, maintained, or approved by any governmental entity, including but not limited to the Israeli Ministry of Defense or the Home Front Command. No relationship, partnership, or affiliation exists between the developers of this project and any government or defense body.  
>  
> The plugin is provided "as is," without any warranties, express or implied. Usage is strictly at your own risk. The developers disclaim all responsibility for any direct, indirect, incidental, or consequential damages that may arise from the use or inability to use this software.  
>  
> This software is not intended to replace or serve as a substitute for any official warning or alert system. Users are strongly advised to rely on official, government-issued alert systems for safety and emergency information.

---

### עברית
> תוכנה זו מהווה יוזמה קהילתית בלתי תלויה, ואינה מופקת, מאושרת, נתמכת או מוסדרת על ידי אף גורם ממשלתי, לרבות אך לא רק משרד הביטחון או פיקוד העורף. אין כל קשר, שותפות או זיקה בין מפתחי פרויקט זה לבין אף גוף ממשלתי או ביטחוני.  
>  
> התוסף מסופק כפי שהוא ("As-Is") ללא כל אחריות מכל סוג, מפורשת או משתמעת. השימוש בתוסף הוא על אחריות המשתמש בלבד. המפתחים מסירים כל אחריות לנזקים ישירים, עקיפים, נלווים או תוצאתיים העלולים להיגרם כתוצאה מהשימוש או מאי היכולת להשתמש בתוכנה זו.  
>  
> תוכנה זו אינה מיועדת להוות תחליף או כלי רשמי למערכות התרעה רשמיות. מומלץ למשתמשים להסתמך על מערכות התרעה רשמיות של המדינה לצרכי בטיחות וחירום בלבד.

---

### العربية
> هذا البرنامج هو مشروع مجتمعي مستقل وغير منتج أو معتمد أو مدعوم أو مصرح به من قبل أي جهة حكومية، بما في ذلك (وليس حصراً) وزارة الأمن أو الجبهة الداخلية في إسرائيل. لا توجد أي علاقة أو شراكة أو ارتباط بين مطوري هذا المشروع وأي جهة حكومية أو عسكرية.  
>  
> يتم توفير هذا البرنامج كما هو ("As-Is") دون أي ضمانات صريحة أو ضمنية. استخدامك للبرنامج على مسؤوليتك الخاصة فقط. يخلي المطورون مسؤوليتهم عن أي أضرار مباشرة أو غير مباشرة أو عرضية أو تبعية قد تنشأ عن استخدام أو عدم القدرة على استخدام هذا البرنامج.  
>  
> هذا البرنامج ليس بديلاً عن الأنظمة الرسمية للإنذار أو التحذير. يُنصح المستخدمون بالاعتماد على أنظمة الإنذار الرسمية فقط لأغراض السلامة والطوارئ.
