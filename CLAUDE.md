# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A macOS menu bar todo list app built with Tauri 2 + React + TypeScript. It runs as a system tray icon — clicking the tray icon toggles a popup window. There's a separate settings window accessible from the tray context menu.

## Commands

- `npm run tauri dev` — run the full app (frontend + Rust backend) in development mode
- `npm run dev` — run only the Vite frontend dev server (no Tauri shell)
- `npm run build` — typecheck and build the frontend
- `cd src-tauri && cargo build` — build only the Rust backend
- `cd src-tauri && cargo check` — typecheck the Rust backend without building

## Architecture

**Two-process model:** The React frontend (`src/`) communicates with the Rust backend (`src-tauri/src/lib.rs`) via Tauri's `invoke` IPC. All data persistence and window management lives in Rust; the frontend is purely presentational.

**Single-file frontend:** All UI lives in `src/App.tsx`. The `?view=settings` query param routes to `SettingsView`; otherwise `TodoView` renders. No router library — just a URL check.

**Single-file backend:** All Rust logic is in `src-tauri/src/lib.rs`. Tauri commands (`#[tauri::command]`) are the IPC boundary. Data is stored as JSON files (`todos.json`, `settings.json`) in the OS app data directory, written atomically via temp file + rename.

**Tauri commands (IPC surface):**
- `load_todos`, `create_todo`, `set_todo_completed`, `rename_todo`, `snooze_todo`, `delete_todo`
- `load_settings`, `save_settings`

**Cross-window communication:** Uses Tauri events (`emit`/`listen`). The settings window emits `settings-updated`; the main window listens and refreshes. The `popup-opened` event triggers data refresh when the tray popup is shown.

**Window behavior:** The main window is frameless, transparent, always-on-top, hidden from taskbar. Close is intercepted to hide instead of quit. On macOS, the app uses `ActivationPolicy::Accessory` to hide from the dock.

**Todo aging:** Open todos are color-coded by age (days since creation or last snooze). Todos with due dates use proximity-to-deadline coloring instead. Thresholds are configurable in settings.
