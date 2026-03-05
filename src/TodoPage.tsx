import { useState, useMemo } from "react";
import { createTodo, updateTodo, deleteTodo } from "./api";
import type { TodoItem, Member } from "./types";

interface Props {
  todos: TodoItem[];
  members: Member[];
  onTodosUpdate: (todos: TodoItem[]) => void;
  onSwitchPage: (page: string) => void;
}

export default function TodoPage({ todos, members, onTodosUpdate }: Props) {
  const [newTodo, setNewTodo] = useState<Partial<TodoItem>>({
    title: "",
    completed: false
  });
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"client" | "commessa" | "businessUnit" | "resource">("client");

  const handleCreateTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!newTodo.title?.trim()) {
      setError("Titolo obbligatorio");
      return;
    }

    try {
      const created = await createTodo({
        title: newTodo.title,
        description: newTodo.description,
        client: newTodo.client,
        commessa: newTodo.commessa,
        businessUnit: newTodo.businessUnit,
        resourceId: newTodo.resourceId,
        completed: false,
        dueDate: newTodo.dueDate
      });
      onTodosUpdate([created, ...todos]);
      setNewTodo({ title: "", completed: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore creazione");
    }
  };

  const handleToggleTodo = async (id: string, completed: boolean) => {
    try {
      const updated = await updateTodo(id, { completed: !completed });
      onTodosUpdate(todos.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore aggiornamento");
    }
  };

  const handleDeleteTodo = async (id: string) => {
    if (!window.confirm("Elimina questo to-do?")) return;
    try {
      await deleteTodo(id);
      onTodosUpdate(todos.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore eliminazione");
    }
  };

  const groupedTodos = useMemo(() => {
    const groups: Record<string, TodoItem[]> = {};

    todos.forEach((todo) => {
      let key = "Senza categoria";
      if (groupBy === "client") key = todo.client || "Senza cliente";
      else if (groupBy === "commessa") key = todo.commessa || "Senza commessa";
      else if (groupBy === "businessUnit") key = todo.businessUnit || "Senza BU";
      else if (groupBy === "resource") {
        const member = members.find((m) => m.id === todo.resourceId);
        key = member?.name || "Senza risorsa";
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(todo);
    });

    return Object.entries(groups).sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  }, [todos, groupBy, members]);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Gestione Attività</p>
          <h1>To-Do List</h1>
          <p className="subtitle">Gestisci i tuoi to-do divisi per cliente, commessa, business unit o risorsa.</p>
        </div>
        <div className="hero-buttons">
          <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "white" }}>
            Raggruppa per:
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)} style={{ padding: "8px" }}>
              <option value="client">Cliente</option>
              <option value="commessa">Commessa</option>
              <option value="businessUnit">Business Unit</option>
              <option value="resource">Risorsa</option>
            </select>
          </label>
        </div>
      </header>

      {error && <div className="alert" style={{ margin: "0 48px 24px" }}>⚠️ {error}</div>}

      <main className="panel">
        <div style={{ marginBottom: "32px" }}>
          <h3>Crea nuovo To-Do</h3>
          <form onSubmit={handleCreateTodo} style={{ display: "grid", gap: "12px" }}>
            <input
              type="text"
              placeholder="Titolo del to-do"
              required
              value={newTodo.title || ""}
              onChange={(e) => setNewTodo((prev) => ({ ...prev, title: e.target.value }))}
            />
            <textarea
              placeholder="Descrizione (opzionale)"
              rows={2}
              value={newTodo.description || ""}
              onChange={(e) => setNewTodo((prev) => ({ ...prev, description: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Cliente (opzionale)"
              value={newTodo.client || ""}
              onChange={(e) => setNewTodo((prev) => ({ ...prev, client: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Commessa (opzionale)"
              value={newTodo.commessa || ""}
              onChange={(e) => setNewTodo((prev) => ({ ...prev, commessa: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Business Unit (opzionale)"
              value={newTodo.businessUnit || ""}
              onChange={(e) => setNewTodo((prev) => ({ ...prev, businessUnit: e.target.value }))}
            />
            <select
              value={newTodo.resourceId || ""}
              onChange={(e) => setNewTodo((prev) => ({ ...prev, resourceId: e.target.value || undefined }))}
            >
              <option value="">Risorsa (opzionale)</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={newTodo.dueDate || ""}
              onChange={(e) => setNewTodo((prev) => ({ ...prev, dueDate: e.target.value || undefined }))}
            />
            <button type="submit" className="primary">
              ➕ Aggiungi To-Do
            </button>
          </form>
        </div>

        <div>
          <h3>Elenco To-Do</h3>
          {groupedTodos.length === 0 ? (
            <p style={{ color: "#64748b", textAlign: "center", padding: "20px" }}>Nessun to-do ancora. Creane uno!</p>
          ) : (
            groupedTodos.map(([groupName, groupTodos]) => (
              <div key={groupName} style={{ marginBottom: "24px" }}>
                <h4 style={{ borderBottom: "2px solid #e2e8f0", paddingBottom: "8px" }}>{groupName}</h4>
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {groupTodos.map((todo) => (
                    <li
                      key={todo.id}
                      style={{
                        display: "flex",
                        alignItems: "start",
                        gap: "12px",
                        padding: "12px",
                        backgroundColor: todo.completed ? "#f0fdf4" : "#fafafa",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        marginBottom: "8px"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={todo.completed}
                        onChange={() => handleToggleTodo(todo.id, todo.completed)}
                        style={{ marginTop: "4px" }}
                      />
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontWeight: "600",
                            textDecoration: todo.completed ? "line-through" : "none",
                            color: todo.completed ? "#94a3b8" : "#1e293b"
                          }}
                        >
                          {todo.title}
                        </div>
                        {todo.description && (
                          <div style={{ fontSize: "14px", color: "#64748b", marginTop: "4px" }}>
                            {todo.description}
                          </div>
                        )}
                        <div
                          style={{
                            display: "flex",
                            gap: "12px",
                            marginTop: "8px",
                            fontSize: "12px",
                            color: "#78909c"
                          }}
                        >
                          {todo.commessa && <span>📌 {todo.commessa}</span>}
                          {todo.businessUnit && <span>🏢 {todo.businessUnit}</span>}
                          {todo.dueDate && (
                            <span style={{ color: new Date(todo.dueDate) < new Date() ? "#ef4444" : "#78909c" }}>
                              📅 {new Date(todo.dueDate).toLocaleDateString("it-IT")}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className="ghost"
                        onClick={() => handleDeleteTodo(todo.id)}
                        style={{ padding: "4px 8px", fontSize: "14px" }}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
