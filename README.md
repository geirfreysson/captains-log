# tiny-todos

Tiny Todos is a macOS menu bar todo list app built with Tauri 2, React, TypeScript, and Rust.

## Features

- Menu bar / tray popup for quick access
- Separate settings window
- Todo creation, completion, renaming, snoozing, deleting, and search
- Optional due dates and age-based coloring for open tasks
- Local JSON persistence in the app data directory

## Development

```bash
npm install
npm run tauri dev
```

Other useful commands:

- `npm run dev` - frontend only
- `npm run build` - typecheck and build the frontend
- `cd src-tauri && cargo check` - Rust backend typecheck

## Releasing the macOS app

A downloadable native macOS app is built automatically by GitHub Actions
(`.github/workflows/release.yml`). To cut a release:

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json` so they match.
2. On GitHub, go to **Releases → Draft a new release**, create a tag (e.g.
   `v0.2.0`), and click **Publish release**.
3. The workflow builds a universal (Apple Silicon + Intel) `.dmg` and attaches
   it to that release as a downloadable asset.

### Signing & notarization

The build works with no setup, but produces an **unsigned** DMG (users open it
via right-click → Open). To ship a signed + Apple-notarized DMG, add the
following repository secrets (**Settings → Secrets and variables → Actions**).
These are the same Apple Developer credentials used by the `northfox` project —
copy the values across:

| Secret in this repo          | Same value as northfox's | What it is                                   |
| ---------------------------- | ------------------------ | -------------------------------------------- |
| `APPLE_CERTIFICATE`          | `CSC_LINK`               | base64 of the Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | `CSC_KEY_PASSWORD`       | password for that `.p12`                     |
| `APPLE_SIGNING_IDENTITY`     | _(new)_                  | `Developer ID Application: NAME (TEAMID)`    |
| `APPLE_API_KEY`              | `APPLE_API_KEY_ID`       | App Store Connect API key id                 |
| `APPLE_API_ISSUER`           | `APPLE_API_ISSUER`       | App Store Connect issuer id                  |
| `APPLE_API_KEY_BASE64`       | `APPLE_API_KEY_BASE64`   | base64 of the `AuthKey_*.p8`                 |

`APPLE_SIGNING_IDENTITY` is the only new value: find it with
`security find-identity -p codesigning -v` on a machine that has the cert
installed (e.g. `Developer ID Application: Your Name (ABCDE12345)`).

## Notes

- Data is stored locally in the OS app data directory.
- The settings panel is available from the tray menu.
- A local `pre-push` hook can enforce pushing only when authenticated to GitHub as `geirfreysson`.
