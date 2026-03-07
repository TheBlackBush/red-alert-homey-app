# RELEASE CHECKLIST 0.2.0 — red-alert-homey-app

## A) Critical Functionality (Required)
- [ ] WS connects within <10 seconds after restart
- [ ] Real alerts (`ALERT`) are received and flow triggers fire
- [ ] `SYSTEM_MESSAGE` events (pre-alert / all-clear) are received and matching triggers fire
- [ ] City filter works (with configured city list)
- [ ] No-filter mode works (match all)
- [ ] Nationwide handling works (when relevant marker is received)
- [ ] `test_trigger` correctly fires `test_alert_received`

## B) Stability and Resilience
- [ ] Reconnect policy works (close/error/stale)
- [ ] Watchdog detects silent connection and recovers
- [ ] No app crashes on parse/empty frame scenarios
- [ ] Dedupe prevents flood but does not drop valid events
- [ ] Fallback platform strategy (WEB→ANDROID) is documented and measurable

## C) Flows + Tokens
- [ ] Tag picker opens correctly (web + mobile)
- [ ] Trigger tokens are available and consistently named
- [ ] `alert_message` / `alert_message_en` / `alert_link` work in real flows
- [ ] Global tokens (`last_alert_*`) work without errors
- [ ] Sample flow sends Telegram message successfully (test + real)

## D) Settings UX
- [ ] Settings screen always loads (no JS/runtime errors)
- [ ] HE/EN language switch works and preference is persisted
- [ ] Cities are displayed in the correct UI language
- [ ] City search dialog works correctly
- [ ] Quiet hours are saved/loaded in agreed format
- [ ] Throttle fields are saved correctly

## E) Diagnostics / Observability
- [ ] `/diagnostics` returns a valid payload
- [ ] Counters are updated during real events
- [ ] Health logs are useful for debugging without being too noisy
- [ ] There is a clear support log collection path

## F) Store / Publish Readiness
- [ ] `homey app validate --level=publish` passes clean
- [ ] `app.json` / compose are consistent (api/widgets/flow)
- [ ] App icon + app images are valid and in correct sizes
- [ ] `readme.txt` and README are updated for v0.2 capabilities
- [ ] Safety disclaimer is clear (does not replace official channels)
- [ ] Changelog for version 0.2.0 is ready

## G) Release Controls
- [ ] Version in `app.json` / `package.json` updated to `0.2.0`
- [ ] Tag + commit message are prepared
- [ ] Soft launch plan is defined (few days)
- [ ] Rollback criteria are defined (e.g., X failures/day)

---

## Go Criteria
Release is allowed when sections A+B+C+F are all green, and section D has no blocker.

## No-Go Criteria
Any issue in:
- Real alerts not received
- Tag picker/token instability
- Consistent flow trigger failures

=> Delay publish and fix first.
