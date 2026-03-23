# Changelog

All notable changes to this project will be documented in this file.

## [0.4.8] - 2026-03-16

### Fixed
- Improved the app's donation section by restoring the PayPal support link.

### Validation
- `homey app validate --level=publish` passes.

## [0.4.7] - 2026-03-16

### Fixed
- Synchronized version metadata across `app.json`, `package.json`, and Homey compose source (`.homeycompose/app.json`).
- Ensured Homey pre-processing no longer rewrites `app.json` back to an older version.

### Validation
- `homey app validate --level=publish` passes.

## [0.4.6] - 2026-03-16

### Note
- Transitional metadata-sync release.
- Superseded by `0.4.7`, which completed full version sync including `.homeycompose/app.json`.

## [0.4.5] - 2026-03-16

### Changed
- Updated README badges to `for-the-badge` style.
- Added Ko-fi support badge to README.
- Added `bugs.url` metadata in `app.json` (issues page).
- Cleaned README by removing explicit Source/Support/Donate plain-text link list.

### Note
- Followed by metadata alignment fixes in `0.4.6` and finalized sync in `0.4.7`.

## [0.4.4] - 2026-03-16

### Changed
- Updated repository references to the new project location under `TheBlackBush/red-alert-homey-app`.
- Updated app metadata links (`source`, `support`) to point to the new GitHub repository and issues page.
- Added `contributing.donate.paypal` metadata in `app.json`.

### Validation
- Metadata files are consistent and app manifest parses correctly.

## [0.4.3] - 2026-03-13

### Changed
- Added/normalized Homey release metadata files and local release rules for consistent publishing flow.

### Validation
- `homey app validate --level=publish` expected to pass with synchronized changelog sources.

## [0.4.2] - 2026-03-11

### Changed
- Refined `README.txt` formatting for better Homey App Store rendering (plain-text friendly structure, simplified sections and lists).
- Documentation alignment pass to keep store-facing text consistent with current token/link behavior.

### Validation
- `npm run lint` passes cleanly.
- `homey app validate --level=publish` passes.

## [0.4.1] - 2026-03-11

### Changed
- Removed `notificationId` fallback from TzevaAdom alert-link generation.
  - New behavior for TzevaAdom links:
    1. use latest resolved id from `alerts-history`
    2. fallback directly to `https://www.tzevaadom.co.il/`
- Renamed internal helper for clarity:
  - `_extractNotificationId` -> `_extractNumericId`.
- Updated Oref source link behavior to use language-specific alerts-history URL based on selected app language:
  - Hebrew: `https://www.oref.org.il/heb/alerts-history`
  - English: `https://www.oref.org.il/eng/alerts-history`
- Updated documentation (`README.md`, `README.txt`) to match current flow cards/tokens and link behavior.

### Validation
- `node --check app.js` passes.
- `npm run lint` passes cleanly.
- `homey app validate --level=publish` passes.

## [0.4.0] - 2026-03-11

### Added
- Alert message now includes direct alert link (`https://www.tzevaadom.co.il/alerts/<id>`) in both full and compact formats.
- New TzevaAdom history-based link resolver:
  - fetches `https://api.tzevaadom.co.il/alerts-history`
  - resolves latest matching alert id by selected/matched cities
  - prefers threat-aware matching when available

### Changed
- Improved link generation priority for TzevaAdom links:
  1. resolved id from alerts-history
  2. fallback to incoming `notificationId`
  3. fallback to TzevaAdom homepage
- Added short cache and in-flight deduplication for `alerts-history` fetches to reduce redundant requests.
- Refactored alert message builder to reduce HE/EN duplication while preserving output behavior.
- Added diagnostics counters for history fetch/link resolution behavior.

### Validation
- `node --check app.js` passes.
- `npm run lint` passes cleanly.
- `homey app validate --level=publish` passes.
- App installed successfully on Homey Pro for verification.

## [0.3.2] - 2026-03-08

### Changed
- Completed lint stabilization and cleanup:
  - broadened ESLint override scope for this codebase
  - applied safe lint autofixes
  - removed remaining lint warnings in alert message builder
- Repository cleanup:
  - removed obsolete backup artifact from tracked files
  - removed unused source image asset

### Validation
- `npm run lint` passes cleanly.
- `homey app validate --level=publish` passes.
- Smoke install to Homey Pro completed successfully.

## [0.3.1] - 2026-03-08

### Changed
- Removed obsolete `RELEASE-CHECKLIST-0.2.0.md` from repository.
- Cleanup/documentation housekeeping:
  - kept only `README.txt` (removed duplicate lowercase readme file)
  - added language selection step to setup instructions
  - added `backups/` to `.gitignore`

### Validation
- App validated successfully with `homey app validate --level=publish`.

## [0.3.0] - 2026-03-08

### Changed
- Simplified widget layout for readability:
  - Removed history list from the widget
  - Removed verbose full-message line
  - Tuned widget height for regular/compact modes
- Updated widget previews to guideline-compliant assets:
  - Replaced `preview-dark.png` (1024x1024, transparent, simplified)
  - Replaced `preview-light.png` (1024x1024, transparent, simplified)
- Improved App Store readme text (`readme.txt` / `README.txt`) with clearer setup guidance.

### Removed
- Removed flow test cards from the app:
  - Trigger `test_alert_received`
  - Action `test_trigger`

### Validation
- App validated successfully with `homey app validate --level=publish`.
- App installed successfully on Homey Pro for verification.

## [0.2.0] - 2026-03-08

### Added
- Unified metadata sync pipeline in JavaScript (`scripts/update-areas-from-network.js`).
- Network-based update flow from Oref `GetDistricts` feeds (HE/EN).
- ID-keyed `cities.json` structure:
  - `cities` keyed by `cityId`
  - `areas` keyed by `areaId`
  - `countdown` keyed by `cityId`
- Updated README documentation for manual metadata update flow.

### Changed
- Forced app timezone handling to `Asia/Jerusalem` for:
  - quiet-hours checks
  - alert timestamp formatting
- Updated city dictionary loading in `app.js` to support the new ID-keyed cities schema.
- Refined metadata generation and synchronization behavior.

### Removed
- Deprecated Python-based metadata source files and generator flow.
- Unused generated artifacts:
  - `data/areas.he.json`
  - `data/areas.en.json`
  - `data/alarm_instructions.he.json`
  - `data/alarm_instructions.en.json`
- Unused `source` field from area metadata payload.

### Validation
- App validation passes with `homey app validate --level=publish`.
- Smoke checks completed and app installed successfully on Homey Pro for testing.
