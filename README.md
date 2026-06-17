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

## Notes

- Data is stored locally in the OS app data directory.
- The settings panel is available from the tray menu.
- A local `pre-push` hook can enforce pushing only when authenticated to GitHub as `geirfreysson`.
