use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use uuid::Uuid;

const WINDOW_LABEL: &str = "main";
const SETTINGS_WINDOW_LABEL: &str = "settings";
const MENU_SETTINGS: &str = "settings";
const MENU_SHOW_HIDE: &str = "show_hide";
const MENU_QUIT: &str = "quit";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Todo {
    id: String,
    label: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    due_at: Option<String>,
    completed: bool,
    created_at: String,
    #[serde(default)]
    snoozed_at: Option<String>,
    #[serde(default)]
    completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameTodoArgs {
    id: String,
    label: String,
    description: String,
    #[serde(default)]
    due_date: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct TodoStore {
    todos: Vec<Todo>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    #[serde(default)]
    font_size: FontSize,
    #[serde(default)]
    age_color_days: AgeColorDays,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            font_size: FontSize::Medium,
            age_color_days: AgeColorDays::default(),
        }
    }
}

impl Default for FontSize {
    fn default() -> Self {
        Self::Medium
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum FontSize {
    Small,
    Medium,
    Large,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgeColorDays {
    yellow: u16,
    amber: u16,
    orange: u16,
    red: u16,
}

impl Default for AgeColorDays {
    fn default() -> Self {
        Self {
            yellow: 3,
            amber: 7,
            orange: 14,
            red: 30,
        }
    }
}

fn todos_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not find app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;

    Ok(app_data_dir.join("todos.json"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not find app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;

    Ok(app_data_dir.join("settings.json"))
}

fn load_store(app: &AppHandle) -> Result<TodoStore, String> {
    let path = todos_path(app)?;

    if !path.exists() {
        let store = TodoStore::default();
        save_store(app, &store)?;
        return Ok(store);
    }

    let contents =
        fs::read_to_string(path).map_err(|error| format!("Could not read todos: {error}"))?;

    serde_json::from_str(&contents).map_err(|error| format!("Could not parse todos: {error}"))
}

fn load_settings_store(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;

    if !path.exists() {
        let settings = AppSettings::default();
        save_settings_store(app, &settings)?;
        return Ok(settings);
    }

    let contents =
        fs::read_to_string(path).map_err(|error| format!("Could not read settings: {error}"))?;

    serde_json::from_str(&contents).map_err(|error| format!("Could not parse settings: {error}"))
}

fn save_store(app: &AppHandle, store: &TodoStore) -> Result<(), String> {
    let path = todos_path(app)?;
    let temp_path = path.with_extension("json.tmp");
    let contents = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Could not serialize todos: {error}"))?;

    fs::write(&temp_path, contents).map_err(|error| format!("Could not write todos: {error}"))?;
    fs::rename(&temp_path, &path).map_err(|error| format!("Could not save todos: {error}"))?;

    Ok(())
}

fn save_settings_store(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let temp_path = path.with_extension("json.tmp");
    let contents = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Could not serialize settings: {error}"))?;

    fs::write(&temp_path, contents)
        .map_err(|error| format!("Could not write settings: {error}"))?;
    fs::rename(&temp_path, &path).map_err(|error| format!("Could not save settings: {error}"))?;

    Ok(())
}

fn now_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn position_popup(
    window: &WebviewWindow,
    anchor: Option<PhysicalPosition<f64>>,
) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) else {
        return Ok(());
    };

    let work_area = monitor.work_area();
    let window_size = window.outer_size()?;
    let margin = 12;
    let min_x = work_area.position.x + margin;
    let max_x =
        work_area.position.x + work_area.size.width as i32 - window_size.width as i32 - margin;
    let min_y = work_area.position.y + margin;
    let max_y =
        work_area.position.y + work_area.size.height as i32 - window_size.height as i32 - margin;
    let (x, y) = if let Some(anchor) = anchor {
        let desired_x = anchor.x.round() as i32 - window_size.width as i32 / 2;
        let desired_y = anchor.y.round() as i32 + margin;

        (desired_x.clamp(min_x, max_x), desired_y.clamp(min_y, max_y))
    } else {
        (max_x, min_y)
    };

    window.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

fn show_popup(window: &WebviewWindow, anchor: Option<PhysicalPosition<f64>>) -> tauri::Result<()> {
    position_popup(window, anchor)?;
    window.show()?;
    window.set_focus()?;
    window.emit("popup-opened", ())?;
    Ok(())
}

fn toggle_popup(app: &AppHandle, anchor: Option<PhysicalPosition<f64>>) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };

    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => {
            let _ = show_popup(&window, anchor);
        }
    }
}

fn show_settings_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let Ok(window) = WebviewWindowBuilder::new(
        app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html?view=settings".into()),
    )
    .title("Settings")
    .inner_size(420.0, 360.0)
    .min_inner_size(420.0, 360.0)
    .max_inner_size(420.0, 360.0)
    .resizable(false)
    .always_on_top(true)
    .center()
    .build() else {
        return;
    };

    let _ = window.set_focus();
}

fn setup_menu_bar(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let handle = app.handle().clone();
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "Settings", true, None::<&str>)?;
    let show_hide = MenuItem::with_id(app, MENU_SHOW_HIDE, "Show/Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &show_hide, &quit])?;
    let icon = app
        .default_window_icon()
        .expect("default app icon is missing")
        .clone();

    TrayIconBuilder::with_id("todo-list")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Todo List")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                position,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popup(&handle, Some(position));
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SETTINGS => show_settings_window(app),
            MENU_SHOW_HIDE => toggle_popup(app, None),
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .build(app)?;

    #[cfg(target_os = "macos")]
    if let Some(webview) = app.get_webview_window(WINDOW_LABEL) {
        let _ = webview.with_webview(|webview| unsafe {
            let wk: &objc2_web_kit::WKWebView = &*webview.inner().cast();
            wk.setAllowsBackForwardNavigationGestures(true);
        });
    }

    let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyT);
    let handle2 = app.handle().clone();
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |_app, _shortcut, event| {
                if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    toggle_popup(&handle2, None);
                }
            })
            .build(),
    )?;
    app.global_shortcut().register(shortcut)?;

    Ok(())
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.hide();
    }
}

#[tauri::command]
fn load_todos(app: AppHandle) -> Result<Vec<Todo>, String> {
    Ok(load_store(&app)?.todos)
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    load_settings_store(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    save_settings_store(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn create_todo(app: AppHandle, label: String) -> Result<Vec<Todo>, String> {
    let label = label.trim().to_string();

    if label.is_empty() {
        return Err("Todo label cannot be empty.".into());
    }

    let mut store = load_store(&app)?;
    store.todos.insert(
        0,
        Todo {
            id: Uuid::new_v4().to_string(),
            label,
            description: String::new(),
            due_at: None,
            completed: false,
            created_at: now_timestamp(),
            snoozed_at: None,
            completed_at: None,
        },
    );
    save_store(&app, &store)?;

    Ok(store.todos)
}

#[tauri::command]
fn set_todo_completed(app: AppHandle, id: String, completed: bool) -> Result<Vec<Todo>, String> {
    let mut store = load_store(&app)?;
    let todo = store
        .todos
        .iter_mut()
        .find(|todo| todo.id == id)
        .ok_or_else(|| "Todo not found.".to_string())?;

    todo.completed = completed;
    todo.completed_at = completed.then(now_timestamp);
    save_store(&app, &store)?;

    Ok(store.todos)
}

#[tauri::command]
fn rename_todo(app: AppHandle, args: RenameTodoArgs) -> Result<Vec<Todo>, String> {
    let label = args.label.trim().to_string();

    if label.is_empty() {
        return Err("Todo label cannot be empty.".into());
    }

    let mut store = load_store(&app)?;
    let todo = store
        .todos
        .iter_mut()
        .find(|todo| todo.id == args.id)
        .ok_or_else(|| "Todo not found.".to_string())?;

    todo.label = label;
    todo.description = args.description;
    todo.due_at = args.due_date.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    save_store(&app, &store)?;

    Ok(store.todos)
}

#[tauri::command]
fn snooze_todo(app: AppHandle, id: String) -> Result<Vec<Todo>, String> {
    let mut store = load_store(&app)?;
    let todo = store
        .todos
        .iter_mut()
        .find(|todo| todo.id == id)
        .ok_or_else(|| "Todo not found.".to_string())?;

    if todo.completed {
        return Err("Completed todos cannot be snoozed.".into());
    }

    todo.snoozed_at = Some(now_timestamp());
    save_store(&app, &store)?;

    Ok(store.todos)
}

#[tauri::command]
fn delete_todo(app: AppHandle, id: String) -> Result<Vec<Todo>, String> {
    let mut store = load_store(&app)?;
    let original_len = store.todos.len();
    store.todos.retain(|todo| todo.id != id);

    if store.todos.len() == original_len {
        return Err("Todo not found.".into());
    }

    save_store(&app, &store)?;

    Ok(store.todos)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(setup_menu_bar)
        .on_window_event(|window, event| {
            if window.label() == WINDOW_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            hide_window,
            load_todos,
            load_settings,
            save_settings,
            create_todo,
            set_todo_completed,
            rename_todo,
            snooze_todo,
            delete_todo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
