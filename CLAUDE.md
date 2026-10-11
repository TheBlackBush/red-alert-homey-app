# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Homey Pro app (Apps SDK v3, app id `il.co.tzevaadom`, store name "Red Alert Israel"; `com.idanbush.redalert` is only the npm package name) that delivers Israeli civil defense (Pikud HaOref) alerts to Homey as **Flow cards and a dashboard widget only**. It has no drivers or devices. User-facing text is bilingual (Hebrew default, English).

## Commands

```bash
npm run lint                  # eslint (athom config) over all .js
npm run validate              # homey app validate --level=publish (also rebuilds app.json from .homeycompose)
npm run check:area-metadata   # dry run: diff Oref districts/cities against data/*.json
npm run sync:area-metadata    # apply: rewrite data/area_metadata.json and data/cities.json
```

Use `npx --no-install homey ...` for CLI commands (the CLI is a devDependency, not installed globally).

There is no test suite. CI (`.github/workflows/homey-validate.yml`) only runs publish-level validation on pushes to `main` and on PRs.

## Architecture

Nearly all logic lives in one `RedAlertApp` class in `app.js`. Everything else is a thin shell around it:

- `api.js`: app Web API (`/cities`, `/diagnostics`), used by `settings/index.html`.
- `widgets/red-alert/api.js` + `widget.compose.json`: widget Web API (`/state`, `/monitoring`, `/cities`, `/policies`, `/threat-types`), used by `widgets/red-alert/public/index.html`.
- Both delegate to public methods on the app: `getPublicState`, `getDiagnostics`, `getCities`, `getThreatTypes`, `setMonitoringEnabled`, `setCities`, `setPolicies`.
- `settings/index.html` reads and writes Homey settings directly (`Homey.get/set`). `onInit` subscribes to `homey.settings.on('set')`, so settings changes such as `monitoring_enabled` take effect live (connect or tear down the WebSocket).

### Alert pipeline (in `app.js`)

1. **Primary source**: WebSocket to `wss://ws.tzevaadom.co.il/socket` (needs `Origin: https://www.tzevaadom.co.il`). It has a ping timer, exponential backoff reconnect, a hard reset after `WS_MAX_STREAK_BEFORE_HARD_RESET` failures, and automatic switching between the `WEB` and `ANDROID` platforms (`ws_platform_preferred`, `ws_auto_fallback` settings).
2. **Watchdog** (`_wsWatchdog`, every 30s): when the socket is stale or down, it polls Oref `Alerts.json` as a fallback (`_runFallbackPoll`) and can infer an all-clear (`_maybeInferAllClearFromFallback`).
3. **`_handleMessage`**: `ALERT` messages carry Hebrew city names and become red alerts (every threat type fires `red_alert_received`; drills are dropped). `SYSTEM_MESSAGE` messages (instruction type 0 = pre-alert, 1 = end/all-clear) carry city IDs. Pre-alerts are dropped during quiet hours and while a primary alert is active. Both are filtered against the user's `selected_city_ids` (`_filterAreasByIds` / `_filterAreasByNames`). An empty selection means all areas. The nationwide pseudo-city (`NATIONWIDE_CITY_ID`, `NATIONWIDE_ALIASES`) always matches.
4. **`_emitEvent`**: dedupe by id and by a signature (type + threat + area key + minute bucket) within `max(DEDUPE_MIN_WINDOW_MS, throttle for that type)`. It then resolves a TzevaAdom alert id through `alerts-history` for the link, updates the global tokens (`last_alert_message`, `last_alert_link`), fires the trigger card with localized tokens, and persists runtime state.

Event types and categories (`primary`, `pre-alert`, `all-clear`, `other`, `test`) drive severity (`SEVERITY_BY_CATEGORY`) and per-type throttling (`DEFAULT_THROTTLE_BY_TYPE_MS`, overridable through the `throttle_by_type_ms` setting). Threat IDs 0 to 8 map through `THREAT_TYPES`. Quiet hours and time formatting use `Asia/Jerusalem`.

State that survives restarts (last event, history, the active-alert flag) is stored in the `runtime_state_v1` setting. History has a 24h TTL and is capped at 50 entries.

### Geographic data

`data/cities.json` (keyed by cityId, with areaId and countdown) and `data/area_metadata.json` (keyed by Hebrew area name, with `m` = shelter time in seconds and `d` = district, plus English labels) are **generated** by `scripts/update-areas-from-network.js` from Oref `GetDistricts.aspx` (he + en). They are read once at startup and never synced at runtime. `AREA_ALIASES` in `app.js` maps legacy or short city names onto current Oref names.

## Homey compose gotcha

`app.json` is **generated** from `.homeycompose/` (app manifest, flow triggers/conditions/actions/tokens). To change a Flow card or the manifest, edit the file under `.homeycompose/`, run `npm run validate` (or `homey app build`) to regenerate `app.json`, and commit both. Hand edits to `app.json` get overwritten on the next build. Widget definitions live in `widgets/red-alert/widget.compose.json` (tracked). Locale strings are in `locales/en.json` and `locales/he.json`.

## Releases

Follow `.claude/release/release-rules.md`. Summary: keep the version identical in `app.json` (through `.homeycompose/app.json`) and `package.json`. Add a matching entry to both `CHANGELOG.md` and `.homeychangelog.json` (`en`, plus `he` when available). Publish validation must pass. Then tag `vX.Y.Z` and create a GitHub Release. Publishing a GitHub Release triggers `.github/workflows/homey-publish.yml`, which publishes to the Homey App Store. A request to "bump the version" implies the full flow, including tag and release.

## Docs and support

Local working docs live in `.claude/` (gitignored and in `.homeyignore`); start at `.claude/README.md`. The user guide is `.claude/support/red-alert-guide.md`, published as `red-alert/README.md` in the `TheBlackBush/homey-apps-support` repo, which generates the wiki page that `app.json` `support` points to. When settings, Flow cards, tokens or the widget change, update the guide in both places. User issues are tracked in `homey-apps-support`, not in this repo.

The `origin` remote is GitHub (`TheBlackBush/red-alert-homey-app`), not the self-hosted GitLab.
