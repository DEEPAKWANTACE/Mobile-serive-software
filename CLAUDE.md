# Project instructions

## Deployment safety

- **"Push repo" means deploy only `mss.wantace.org`.** Commit and push the current work, then deploy branch `main` in `/var/www/Mobile-serive-software` on SSH host `mu` and restart PM2 process `mss-api`.
- Never touch `mss2.wantace.org`, branch `mss2`, `/var/www/Mobile-serive-software-mss2`, or PM2 process `mss2-api` unless the user explicitly asks for an `mss2` change or deployment.
- Follow the complete project instructions in `AGENTS.md`.

## Git

- Do not add `Co-Authored-By` or AI attribution.
