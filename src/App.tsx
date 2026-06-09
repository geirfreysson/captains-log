import { FormEvent, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Clock, Pencil, Plus, Trash2 } from "lucide-react";
import "./App.css";

type Todo = {
  id: string;
  label: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string | null;
};

type FontSize = "small" | "medium" | "large";

type AppSettings = {
  fontSize: FontSize;
  ageColorDays: AgeColorDays;
};

type AgeColorDays = {
  yellow: number;
  amber: number;
  orange: number;
  red: number;
};

const defaultSettings: AppSettings = {
  fontSize: "medium",
  ageColorDays: {
    yellow: 3,
    amber: 7,
    orange: 14,
    red: 30,
  },
};

function App() {
  const view = new URLSearchParams(window.location.search).get("view");

  if (view === "settings") {
    return <SettingsView />;
  }

  return <TodoView />;
}

function SettingsView() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [error, setError] = useState("");

  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then(setSettings)
      .catch((value) =>
        setError(value instanceof Error ? value.message : String(value)),
      );
  }, []);

  async function updateFontSize(fontSize: FontSize) {
    const nextSettings = { ...settings, fontSize };
    await saveSettings(nextSettings);
  }

  async function updateAgeColorDay(
    key: keyof AgeColorDays,
    value: string,
  ) {
    const days = Math.max(1, Math.floor(Number(value) || 1));
    const nextSettings = {
      ...settings,
      ageColorDays: {
        ...settings.ageColorDays,
        [key]: days,
      },
    };

    await saveSettings(nextSettings);
  }

  async function saveSettings(nextSettings: AppSettings) {
    setSettings(nextSettings);
    setError("");

    try {
      const savedSettings = await invoke<AppSettings>("save_settings", {
        settings: nextSettings,
      });

      setSettings(savedSettings);
      await emit("settings-updated", savedSettings);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  return (
    <main className="settings-shell">
      <section className="settings-panel" aria-label="Settings">
        <header className="settings-header">
          <h1>Settings</h1>
        </header>

        <div className="settings-row">
          <div>
            <p className="settings-label">Font size</p>
          </div>
          <div className="segmented-control" role="group" aria-label="Font size">
            {(["small", "medium", "large"] as FontSize[]).map((fontSize) => (
              <button
                className={settings.fontSize === fontSize ? "selected" : ""}
                key={fontSize}
                onClick={() => updateFontSize(fontSize)}
                type="button"
              >
                {fontSize}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-group">
          <header className="settings-group-header">
            <p className="settings-label">Age colours</p>
            <p className="settings-hint">Live days</p>
          </header>
          <div className="age-threshold-grid">
            {(
              [
                ["yellow", "Yellow"],
                ["amber", "Amber"],
                ["orange", "Orange"],
                ["red", "Red"],
              ] as [keyof AgeColorDays, string][]
            ).map(([key, label]) => (
              <label className={`age-threshold age-threshold-${key}`} key={key}>
                <span>{label}</span>
                <input
                  aria-label={`${label} after days`}
                  min="1"
                  onChange={(event) =>
                    updateAgeColorDay(key, event.currentTarget.value)
                  }
                  type="number"
                  value={settings.ageColorDays[key]}
                />
              </label>
            ))}
          </div>
        </div>

        {error ? <p className="error-message">{error}</p> : null}
      </section>
    </main>
  );
}

function TodoView() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [visibleList, setVisibleList] = useState<"open" | "done">("open");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  const openTodos = useMemo(
    () =>
      todos
        .filter((todo) => !todo.completed)
        .slice()
        .sort((a, b) => {
          const aTime = Date.parse(a.createdAt);
          const bTime = Date.parse(b.createdAt);

          return aTime - bTime;
        }),
    [todos],
  );
  const doneTodos = useMemo(
    () =>
      todos
        .filter((todo) => todo.completed)
        .slice()
        .sort((a, b) => {
          const aTime = Date.parse(a.completedAt ?? a.createdAt);
          const bTime = Date.parse(b.completedAt ?? b.createdAt);

          return bTime - aTime;
        }),
    [todos],
  );
  const visibleTodos = visibleList === "open" ? openTodos : doneTodos;
  const visibleCount = visibleTodos.length;
  const counterLabel =
    visibleList === "open" ? "Show done tasks" : "Show open tasks";
  const emptyMessage =
    visibleList === "open" ? "All clear." : "No done tasks yet.";
  const paneLabel = visibleList === "open" ? "Open tasks" : "Done tasks";
  const nextList = visibleList === "open" ? "done" : "open";
  const nextCount = visibleList === "open" ? doneTodos.length : openTodos.length;

  const displayDate = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    [],
  );

  useEffect(() => {
    refreshData().finally(() => setIsLoading(false));

    const unlisten = listen<AppSettings>("settings-updated", (event) => {
      setSettings(event.payload);
    });
    const unlistenPopupOpened = listen("popup-opened", () => {
      refreshData();
    });

    return () => {
      unlisten.then((dispose) => dispose());
      unlistenPopupOpened.then((dispose) => dispose());
    };
  }, []);

  function showError(value: unknown) {
    setError(value instanceof Error ? value.message : String(value));
  }

  async function refreshData() {
    try {
      const [nextTodos, nextSettings] = await Promise.all([
        invoke<Todo[]>("load_todos"),
        invoke<AppSettings>("load_settings"),
      ]);

      setTodos(nextTodos);
      setSettings(nextSettings);
    } catch (value) {
      showError(value);
    }
  }

  async function addTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const label = newLabel.trim();
    if (!label || isCreating) {
      return;
    }

    setError("");
    setIsCreating(true);

    try {
      setTodos(await invoke<Todo[]>("create_todo", { label }));
      setNewLabel("");
    } catch (value) {
      showError(value);
    } finally {
      setIsCreating(false);
    }
  }

  async function setCompleted(id: string, completed: boolean) {
    setError("");
    setPendingId(id);

    try {
      setTodos(
        await invoke<Todo[]>("set_todo_completed", {
          id,
          completed,
        }),
      );
    } catch (value) {
      showError(value);
    } finally {
      setPendingId(null);
    }
  }

  async function deleteTodo(id: string) {
    setError("");
    setPendingId(id);

    try {
      setTodos(await invoke<Todo[]>("delete_todo", { id }));
    } catch (value) {
      showError(value);
    } finally {
      setPendingId(null);
    }
  }

  async function snoozeTodo(id: string) {
    setError("");
    setPendingId(id);

    try {
      setTodos(await invoke<Todo[]>("snooze_todo", { id }));
    } catch (value) {
      showError(value);
    } finally {
      setPendingId(null);
    }
  }

  function startEditing(todo: Todo) {
    setError("");
    setEditingId(todo.id);
    setEditingLabel(todo.label);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingLabel("");
  }

  async function saveEditing(todo: Todo) {
    const label = editingLabel.trim();

    if (!editingId) {
      return;
    }

    if (!label) {
      setError("Todo label cannot be empty.");
      return;
    }

    if (label === todo.label) {
      cancelEditing();
      return;
    }

    setError("");
    setPendingId(todo.id);

    try {
      setTodos(await invoke<Todo[]>("rename_todo", { id: todo.id, label }));
      cancelEditing();
    } catch (value) {
      showError(value);
    } finally {
      setPendingId(null);
    }
  }

  function renderTodo(todo: Todo) {
    const isEditing = editingId === todo.id;
    const ageClassName =
      visibleList === "open" ? getAgeClassName(todo, settings.ageColorDays) : "";

    return (
      <li
        className={`todo-row ${todo.completed ? "todo-row-done" : ""} ${ageClassName} ${isEditing ? "is-editing" : ""}`}
        key={todo.id}
      >
        <label className="todo-label">
          <input
            checked={todo.completed}
            disabled={pendingId === todo.id || isEditing}
            onChange={(event) =>
              setCompleted(todo.id, event.currentTarget.checked)
            }
            type="checkbox"
          />
          {isEditing ? (
            <input
              aria-label={`Rename ${todo.label}`}
              autoFocus
              className="edit-input"
              disabled={pendingId === todo.id}
              onBlur={() => saveEditing(todo)}
              onChange={(event) => setEditingLabel(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }

                if (event.key === "Escape") {
                  cancelEditing();
                }
              }}
              type="text"
              value={editingLabel}
            />
          ) : (
            <span>{todo.label}</span>
          )}
        </label>
        <div className="row-actions">
          {!todo.completed ? (
            <button
              aria-label={`Snooze ${todo.label}`}
              className="icon-button snooze-button"
              disabled={pendingId === todo.id || isEditing}
              onClick={() => snoozeTodo(todo.id)}
              title="Snooze todo"
              type="button"
            >
              <Clock aria-hidden="true" size={17} strokeWidth={2.1} />
            </button>
          ) : null}
          <button
            aria-label={`Rename ${todo.label}`}
            className="icon-button edit-button"
            disabled={pendingId === todo.id || isEditing}
            onClick={() => startEditing(todo)}
            title="Rename todo"
            type="button"
          >
            <Pencil aria-hidden="true" size={17} strokeWidth={2.1} />
          </button>
          <button
            aria-label={`Delete ${todo.label}`}
            className="icon-button delete-button"
            disabled={pendingId === todo.id}
            onClick={() => deleteTodo(todo.id)}
            title="Delete todo"
            type="button"
          >
            <Trash2 aria-hidden="true" size={18} strokeWidth={2.1} />
          </button>
        </div>
      </li>
    );
  }

  return (
    <main className={`app-shell font-${settings.fontSize}`}>
      <section className="todo-panel" aria-label="Todo list">
        <div className="date-header">
          <p className="date-label">{displayDate}</p>
          <button
            aria-label={counterLabel}
            className="count-pill"
            onClick={() => setVisibleList(nextList)}
            title={`${counterLabel} (${nextCount})`}
            type="button"
          >
            {visibleCount}
          </button>
        </div>

        <form className="add-form" onSubmit={addTodo}>
          <input
            aria-label="New todo"
            value={newLabel}
            onChange={(event) => setNewLabel(event.currentTarget.value)}
            placeholder="Add a task"
          />
          <button
            aria-label="Add todo"
            className="icon-button add-button"
            disabled={!newLabel.trim() || isCreating}
            title="Add todo"
            type="submit"
          >
            <Plus aria-hidden="true" size={20} strokeWidth={2.2} />
          </button>
        </form>

        {error ? <p className="error-message">{error}</p> : null}

        <div className="task-panes">
          {isLoading ? (
            <div className="list-frame open-pane">
              <p className="empty-state">Loading...</p>
            </div>
          ) : todos.length === 0 ? (
            <div className="list-frame open-pane">
              <p className="empty-state">No todos yet.</p>
            </div>
          ) : (
            <section className="list-frame open-pane" aria-label={paneLabel}>
              {visibleTodos.length === 0 ? (
                <p className="empty-state">{emptyMessage}</p>
              ) : (
                <ul className="todo-list" key={visibleList}>
                  {visibleTodos.map(renderTodo)}
                </ul>
              )}
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

function getAgeClassName(todo: Todo, thresholds: AgeColorDays) {
  const createdAt = Date.parse(todo.createdAt);

  if (!Number.isFinite(createdAt)) {
    return "";
  }

  const daysLive = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);

  if (daysLive >= thresholds.red) {
    return "todo-age-red";
  }

  if (daysLive >= thresholds.orange) {
    return "todo-age-orange";
  }

  if (daysLive >= thresholds.amber) {
    return "todo-age-amber";
  }

  if (daysLive >= thresholds.yellow) {
    return "todo-age-yellow";
  }

  return "";
}

export default App;
