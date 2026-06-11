import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { ChevronDown, Plus } from "lucide-react";
import "./App.css";

type Todo = {
  id: string;
  label: string;
  description: string;
  dueAt?: string | null;
  completed: boolean;
  createdAt: string;
  snoozedAt?: string | null;
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
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [visibleList, setVisibleList] = useState<"open" | "done">("open");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingDueDate, setEditingDueDate] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const fromPopstateRef = useRef(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  const openTodos = useMemo(
    () =>
      todos
        .filter((todo) => !todo.completed)
        .slice()
        .sort((a, b) => {
          const aDue = a.dueAt ? parseFlexibleTimestamp(a.dueAt) : Infinity;
          const bDue = b.dueAt ? parseFlexibleTimestamp(b.dueAt) : Infinity;

          if (aDue !== bDue) {
            return aDue - bDue;
          }

          const aTime = Date.parse(getLiveStartAt(a));
          const bTime = Date.parse(getLiveStartAt(b));

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
  const editingTodo = todos.find((todo) => todo.id === editingId) ?? null;

  const doneWeekGroups = useMemo(() => {
    if (visibleList !== "done") return [];

    const groups: { label: string; todos: Todo[] }[] = [];
    let currentKey = "";
    let currentGroup: { label: string; todos: Todo[] } | null = null;

    for (const todo of doneTodos) {
      const completedDate = new Date(todo.completedAt ?? todo.createdAt);
      const weekStart = getWeekStart(completedDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const key = weekStart.toISOString();

      if (key !== currentKey) {
        currentKey = key;
        currentGroup = {
          label: formatWeekRange(weekStart, weekEnd),
          todos: [],
        };
        groups.push(currentGroup);
      }

      currentGroup!.todos.push(todo);
    }

    return groups;
  }, [doneTodos, visibleList]);

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
      setSelectedIndex(-1);
      setTimeout(() => addInputRef.current?.focus(), 50);
    });

    return () => {
      unlisten.then((dispose) => dispose());
      unlistenPopupOpened.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (!editingId) return;

    function handlePopState() {
      fromPopstateRef.current = true;
      cancelEditing();
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [editingId]);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [visibleList]);

  useEffect(() => {
    if (editingId) return;

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const isAddInput = target === addInputRef.current;
      const isTyping =
        (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable) && !isAddInput;

      if (event.key === "Escape") {
        event.preventDefault();
        invoke("hide_window");
        return;
      }

      if (isTyping) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (isAddInput) addInputRef.current?.blur();
        setSelectedIndex((prev) => {
          const max = visibleTodos.length - 1;
          return prev < max ? prev + 1 : max;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (isAddInput) addInputRef.current?.blur();
        setSelectedIndex((prev) => {
          if (prev <= 0) {
            addInputRef.current?.focus();
            return -1;
          }
          return prev - 1;
        });
        return;
      }

      if (isAddInput) return;

      if (event.key === "Enter" && selectedIndex >= 0) {
        event.preventDefault();
        const todo = visibleTodos[selectedIndex];
        if (todo) startEditing(todo);
        return;
      }

      if (event.key === " " && selectedIndex >= 0) {
        event.preventDefault();
        const todo = visibleTodos[selectedIndex];
        if (todo) setCompleted(todo.id, !todo.completed);
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingId, selectedIndex, visibleTodos]);

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
      await invoke<Todo[]>("create_todo", { label });
      await refreshData();
      setNewLabel("");
    } catch (value) {
      showError(value);
    } finally {
      setIsCreating(false);
    }
  }

  async function setCompleted(id: string, completed: boolean) {
    setError("");

    if (completed) {
      setCompletingId(id);
      await new Promise((resolve) => setTimeout(resolve, 800));
      setCompletingId(null);
    }

    setPendingId(id);

    try {
      await invoke<Todo[]>("set_todo_completed", {
        id,
        completed,
      });
      await refreshData();
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
      await invoke<Todo[]>("delete_todo", { id });
      await refreshData();
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
      await invoke<Todo[]>("snooze_todo", { id });
      await refreshData();
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
    setEditingDescription(todo.description ?? "");
    setEditingDueDate(todo.dueAt ?? "");
    window.history.pushState({ editing: true }, "");
  }

  function cancelEditing() {
    const wasEditing = editingId !== null;
    const fromPopstate = fromPopstateRef.current;
    fromPopstateRef.current = false;

    setEditingId(null);
    setEditingLabel("");
    setEditingDescription("");
    setEditingDueDate("");
    setMenuOpen(false);

    if (wasEditing && !fromPopstate) {
      window.history.back();
    }
  }

  async function saveEditing(todo: Todo) {
    const label = editingLabel.trim();
    const description = editingDescription;
    const dueDate = editingDueDate.trim();

    if (!editingId) {
      return;
    }

    if (!label) {
      setError("Todo label cannot be empty.");
      return;
    }

    if (
      label === todo.label &&
      description === (todo.description ?? "") &&
      dueDate === (todo.dueAt ?? "")
    ) {
      cancelEditing();
      return;
    }

    setError("");
    setPendingId(todo.id);

    try {
      await invoke<Todo[]>("rename_todo", {
        args: {
          id: todo.id,
          label,
          description,
          dueDate: dueDate || null,
        },
      });
      cancelEditing();
      await refreshData();
    } catch (value) {
      showError(value);
    } finally {
      setPendingId(null);
    }
  }

  function renderTodo(todo: Todo, index: number) {
    const ageClassName =
      visibleList === "open"
        ? getTodoColorClassName(todo, settings.ageColorDays)
        : "";
    const isSelected = index === selectedIndex;
    const isCompleting = completingId === todo.id;

    return (
      <li
        className={`todo-row ${todo.completed ? "todo-row-done" : ""} ${ageClassName} ${isSelected ? "todo-row-selected" : ""} ${isCompleting ? "todo-row-completing" : ""}`}
        key={todo.id}
      >
        <input
          checked={todo.completed || isCompleting}
          className="todo-checkbox"
          disabled={pendingId === todo.id || isCompleting}
          onChange={(event) =>
            setCompleted(todo.id, event.currentTarget.checked)
          }
          type="checkbox"
        />
        <button
          className="todo-label-button"
          disabled={pendingId === todo.id}
          onClick={() => startEditing(todo)}
          type="button"
        >
          {todo.label}
        </button>
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
            ref={addInputRef}
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
              {editingTodo ? (
                <div className="editor-view">
                  <div className="editor-header">
                    <label className="editor-title-field">
                      <input
                        aria-label={`Task title for ${editingTodo.label}`}
                        autoFocus
                        className="editor-input editor-title-input"
                        disabled={pendingId === editingTodo.id}
                        onChange={(event) =>
                          setEditingLabel(event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            saveEditing(editingTodo);
                          }

                          if (event.key === "Escape") {
                            cancelEditing();
                          }
                        }}
                        type="text"
                        value={editingLabel}
                      />
                    </label>

                    <div className="editor-dropdown">
                      <button
                        aria-label="More actions"
                        className="icon-button editor-menu-button"
                        onClick={() => setMenuOpen(!menuOpen)}
                        type="button"
                      >
                        <ChevronDown aria-hidden="true" size={18} strokeWidth={2.1} />
                      </button>
                      {menuOpen ? (
                        <div className="editor-dropdown-menu">
                          {!editingTodo.completed ? (
                            <button
                              disabled={pendingId === editingTodo.id}
                              onClick={() => {
                                setMenuOpen(false);
                                snoozeTodo(editingTodo.id);
                              }}
                              type="button"
                            >
                              Snooze
                            </button>
                          ) : null}
                          <button
                            className="editor-dropdown-delete"
                            disabled={pendingId === editingTodo.id}
                            onClick={() => {
                              setMenuOpen(false);
                              deleteTodo(editingTodo.id);
                            }}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="editor-meta">
                    <div className="editor-meta-item">
                      <span className="editor-meta-label">Created at</span>
                      <span className="editor-meta-value">
                        {formatTimestamp(editingTodo.createdAt)}
                      </span>
                    </div>
                    <div className="editor-meta-item">
                      <span className="editor-meta-label">Snoozed at</span>
                      <span className="editor-meta-value">
                        {editingTodo.snoozedAt
                          ? formatTimestamp(editingTodo.snoozedAt)
                          : "—"}
                      </span>
                    </div>
                  </div>

                  <label className="editor-due-date-field">
                    <span className="editor-meta-label">Due date</span>
                    <input
                      aria-label={`Due date for ${editingTodo.label}`}
                      className="editor-input editor-due-date-input"
                      disabled={pendingId === editingTodo.id}
                      onChange={(event) =>
                        setEditingDueDate(event.currentTarget.value)
                      }
                      type="date"
                      value={editingDueDate}
                    />
                  </label>

                  <label className="editor-description-field">
                    <span className="editor-meta-label">Description</span>
                    <textarea
                      aria-label={`Description for ${editingTodo.label}`}
                      className="editor-input editor-description-input"
                      disabled={pendingId === editingTodo.id}
                      onChange={(event) =>
                        setEditingDescription(event.currentTarget.value)
                      }
                      placeholder="Add notes"
                      rows={6}
                      value={editingDescription}
                    />
                  </label>

                  <div className="editor-actions">
                    <button
                      className="editor-button editor-cancel"
                      disabled={pendingId === editingTodo.id}
                      onClick={cancelEditing}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="editor-button editor-save"
                      disabled={
                        pendingId === editingTodo.id ||
                        !editingLabel.trim()
                      }
                      onClick={() => saveEditing(editingTodo)}
                      type="button"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : visibleTodos.length === 0 ? (
                <p className="empty-state">{emptyMessage}</p>
              ) : visibleList === "done" ? (
                <div className="done-groups" key="done">
                  {(() => {
                    let flatIndex = 0;
                    return doneWeekGroups.map((group) => (
                      <div className="done-week-group" key={group.label}>
                        <p className="week-header">{group.label}</p>
                        <ul className="todo-list">
                          {group.todos.map((todo) => {
                            const el = renderTodo(todo, flatIndex);
                            flatIndex++;
                            return el;
                          })}
                        </ul>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <ul className="todo-list" key={visibleList}>
                  {visibleTodos.map((todo, index) => renderTodo(todo, index))}
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
  const liveStartAt = Date.parse(getLiveStartAt(todo));

  if (!Number.isFinite(liveStartAt)) {
    return "";
  }

  const daysLive = (Date.now() - liveStartAt) / (1000 * 60 * 60 * 24);

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

function getTodoColorClassName(todo: Todo, thresholds: AgeColorDays) {
  if (todo.dueAt) {
    return getDueDateClassName(todo.dueAt, thresholds);
  }

  return getAgeClassName(todo, thresholds);
}

function getDueDateClassName(dueAt: string, thresholds: AgeColorDays) {
  const dueDate = parseFlexibleTimestamp(dueAt);

  if (!Number.isFinite(dueDate)) {
    return "";
  }

  const daysUntilDue = (dueDate - Date.now()) / (1000 * 60 * 60 * 24);

  if (daysUntilDue < 0) {
    return "todo-due-overdue";
  }

  if (daysUntilDue <= thresholds.yellow) {
    return "todo-due-close";
  }

  if (daysUntilDue <= thresholds.amber) {
    return "todo-due-soon";
  }

  if (daysUntilDue <= thresholds.orange) {
    return "todo-due-mid";
  }

  if (daysUntilDue <= thresholds.red) {
    return "todo-due-far";
  }

  return "todo-due-far";
}

function getLiveStartAt(todo: Todo) {
  return todo.snoozedAt ?? todo.createdAt;
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function parseFlexibleTimestamp(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return Number.NaN;
  }

  if (trimmed.length > 10) {
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? Number.NaN : parsed;
  }

  const [year, month, day] = trimmed.split("-").map((part) => Number(part));

  if (!year || !month || !day) {
    return Number.NaN;
  }

  return new Date(year, month - 1, day).getTime();
}

function getWeekStart(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

function formatWeekRange(start: Date, end: Date) {
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export default App;
