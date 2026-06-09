import { FormEvent, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Pencil, Plus, Trash2 } from "lucide-react";
import "./App.css";

type Todo = {
  id: string;
  label: string;
  completed: boolean;
  createdAt: string;
};

function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [visibleList, setVisibleList] = useState<"open" | "done">("open");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  const openTodos = useMemo(
    () => todos.filter((todo) => !todo.completed),
    [todos],
  );
  const doneTodos = useMemo(
    () => todos.filter((todo) => todo.completed),
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
    invoke<Todo[]>("load_todos")
      .then(setTodos)
      .catch(showError)
      .finally(() => setIsLoading(false));
  }, []);

  function showError(value: unknown) {
    setError(value instanceof Error ? value.message : String(value));
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

    return (
      <li
        className={`todo-row ${todo.completed ? "todo-row-done" : ""}`}
        key={todo.id}
      >
        <div className="todo-label">
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
        </div>
        <div className="row-actions">
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
    <main className="app-shell">
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

export default App;
