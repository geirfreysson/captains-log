use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Todo {
    id: String,
    label: String,
    completed: bool,
    created_at: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct TodoStore {
    todos: Vec<Todo>,
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

fn save_store(app: &AppHandle, store: &TodoStore) -> Result<(), String> {
    let path = todos_path(app)?;
    let temp_path = path.with_extension("json.tmp");
    let contents = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Could not serialize todos: {error}"))?;

    fs::write(&temp_path, contents).map_err(|error| format!("Could not write todos: {error}"))?;
    fs::rename(&temp_path, &path).map_err(|error| format!("Could not save todos: {error}"))?;

    Ok(())
}

fn now_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
fn load_todos(app: AppHandle) -> Result<Vec<Todo>, String> {
    Ok(load_store(&app)?.todos)
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
            completed: false,
            created_at: now_timestamp(),
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
    save_store(&app, &store)?;

    Ok(store.todos)
}

#[tauri::command]
fn rename_todo(app: AppHandle, id: String, label: String) -> Result<Vec<Todo>, String> {
    let label = label.trim().to_string();

    if label.is_empty() {
        return Err("Todo label cannot be empty.".into());
    }

    let mut store = load_store(&app)?;
    let todo = store
        .todos
        .iter_mut()
        .find(|todo| todo.id == id)
        .ok_or_else(|| "Todo not found.".to_string())?;

    todo.label = label;
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
        .invoke_handler(tauri::generate_handler![
            load_todos,
            create_todo,
            set_todo_completed,
            rename_todo,
            delete_todo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
