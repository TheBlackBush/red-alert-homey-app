# Changelog

All notable changes to this project will be documented in this file.

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
