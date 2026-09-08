# Contributing to BidLume

Thank you for helping improve BidLume. Keep changes focused on the extension's single purpose: evaluating supported Upwork job listings for risk, client quality, budget fit, and skill match.

## Before opening a pull request

1. Create a branch from `main`.
2. Make the smallest clear change that solves the issue.
3. Do not commit API keys, CV content, real user data, generated store ZIPs, or `Store_Submission/` working files.
4. Add or update tests for behavior changes.
5. Run:

```bash
npm run check
npm run build:store
```

## Code guidelines

- Keep the production extension dependency-free and compatible with Manifest V3.
- Do not add remote JavaScript, remote CSS, analytics, or broad host permissions.
- Escape or render as text any content that originated from a webpage, AI provider, or local history.
- Add every new user-facing string to all seven locales and preserve interpolation placeholders.
- Keep optional AI behavior explicit and disclose any new data transfer in `privacy.md`.
- Update the manifest version and store notes when preparing a release.

## Pull request notes

Explain what changed, why it changed, its privacy/permission impact, and the checks you ran. Include screenshots only when they help reviewers verify a UI change; Chrome Web Store marketing assets stay outside the public repository.
