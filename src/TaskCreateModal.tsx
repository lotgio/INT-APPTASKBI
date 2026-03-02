import { useState } from "react";
import { createTask } from "./api";
import type { Task } from "./types";

interface Props {
  onTaskCreated: (task: Task) => void;
  onClose: () => void;
}

const emptyTask = {
  commessa: "",
  description: "",
  client: "",
  hours: 1,
  status: "todo" as const
};

export default function TaskCreateModal({ onTaskCreated, onClose }: Props) {
  const [taskDraft, setTaskDraft] = useState(emptyTask);
  const [error, setError] = useState<string | null>(null);

  const handleCreateTask = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const created = await createTask({
        ...taskDraft,
        hours: Number(taskDraft.hours)
      });
      onTaskCreated(created);
      setTaskDraft(emptyTask);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore creazione task");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Crea nuovo task</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className="alert">{error}</div>}

        <form className="modal-body" onSubmit={handleCreateTask}>
          <label>
            Numero commessa
            <input
              required
              value={taskDraft.commessa}
              onChange={(event) =>
                setTaskDraft((prev) => ({ ...prev, commessa: event.target.value }))
              }
              placeholder="Es. 2026-012"
            />
          </label>

          <label>
            Descrizione
            <textarea
              required
              rows={4}
              value={taskDraft.description}
              onChange={(event) =>
                setTaskDraft((prev) => ({ ...prev, description: event.target.value }))
              }
              placeholder="Descrivi l'attività"
            />
          </label>

          <label>
            Cliente
            <input
              required
              value={taskDraft.client}
              onChange={(event) =>
                setTaskDraft((prev) => ({ ...prev, client: event.target.value }))
              }
              placeholder="Es. Acme Corp"
            />
          </label>

          <label>
            Ore dedicate
            <input
              required
              type="number"
              step="0.5"
              min="0.5"
              value={taskDraft.hours}
              onChange={(event) =>
                setTaskDraft((prev) => ({
                  ...prev,
                  hours: parseFloat(event.target.value) || 0
                }))
              }
            />
          </label>

          <div className="modal-footer">
            <button type="button" className="secondary" onClick={onClose}>
              Annulla
            </button>
            <button type="submit" className="primary">
              Crea task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
