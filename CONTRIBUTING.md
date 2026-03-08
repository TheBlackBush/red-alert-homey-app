# Contributing to red-alert-homey-app

First of all, thanks for taking the time to contribute 🙌

This project is a Homey app for Israeli red alert monitoring. Contributions are
welcome for bug fixes, reliability improvements, UX polish, documentation, and
metadata quality.

## Before opening an issue

Please check:

- Did you read the error message/logs carefully?
- Is there already an existing issue for the same problem?
- Did you update your local branch to latest `master`?
- Can you reproduce the problem consistently?

## Great bug reports include

- **Context:** what were you trying to do?
- **Reproduction steps:** minimal, clear, from a clean start
- **Expected vs actual behavior**
- **Logs/screenshots** where applicable
- **Environment:** Homey model/version, app version

## Great feature requests include

- Current behavior
- Why it is a problem
- Proposed solution
- Practical use case
- Caveats/trade-offs

## Pull request guidelines

- Keep changes focused and minimal
- One topic per PR
- Rebase on latest `master`
- Keep code style consistent with existing code
- Run checks before opening PR:

```bash
npm run lint
npm run validate
npm run check:area-metadata
```

- If your PR changes behavior, update docs (`README.md`, `README.txt`,
  changelog as needed)

## Local development

```bash
npm ci --include=dev
npm run lint
npm run validate
homey app install
```

## Metadata sync changes

If your PR touches area/city metadata flow, include:

- What source endpoint(s) were used
- Any filtering rule changes
- Before/after counts (cities, areas)

## Code of Conduct

By participating, you agree to follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
