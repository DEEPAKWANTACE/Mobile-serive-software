# Project instructions

## Deployment

- When the user says **"push repo"**, commit and push the current changes, then deploy **only** the main production instance:
  - Domain: `https://mss.wantace.org`
  - Branch: `main`
  - SSH host: `mu`
  - Directory: `/var/www/Mobile-serive-software`
  - PM2 process: `mss-api`
- Do **not** pull, build, restart, reconfigure, or otherwise modify `mss2.wantace.org`, the `mss2` branch, `/var/www/Mobile-serive-software-mss2`, or the `mss2-api` PM2 process when the user only says **"push repo"**.
- Change or deploy the `mss2` instance only when the user explicitly mentions `mss2` and requests that action.

## Git

- Never add a `Co-Authored-By` line or AI attribution to commits or pull requests.

## Tests

- Do not run tests on every prompt. Run them when requested or when a change clearly needs verification.
