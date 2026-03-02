import { useState } from "react";
import type { Task, TaskStatus, Member } from "./types";

interface Props {
  task: Task;
  members: Member[];
  onSave: (updated: Task) => void;
  onClose: () => void;
}

const statusLabels: Record<TaskStatus, string> = {
  todo: "Da fare",
  "in-progress": "In corso",
  done: "Completato"
};

export default function TaskDetailModal({ task, members, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(task);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);

    // Validazione base
    if (!draft.commessa || !draft.description || !draft.client || draft.hours < 0.5) {
      setError("Compila tutti i campi obbligatori");
      return;
    }

    try {
      onSave(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore salvataggio");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Modifica Task</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className="alert">{error}</div>}

        <div className="modal-body">
          <label>
            Numero commessa
            <input
              required
              value={draft.commessa}
              onChange={(e) => setDraft((prev) => ({ ...prev, commessa: e.target.value }))}
              placeholder="Es. 2026-012"
            />
          </label>

          <label>
            Descrizione
            <textarea
              required
              rows={4}
              value={draft.description}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Descrivi l'attività"
            />
          </label>

          <label>
            Cliente
            <input
              required
              value={draft.client}
              onChange={(e) => setDraft((prev) => ({ ...prev, client: e.target.value }))}
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
              value={draft.hours}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  hours: parseFloat(e.target.value) || 0
                }))
              }
            />
          </label>

          <label>
            Assegnatario
            <select
              value={draft.assigneeId ?? ""}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  assigneeId: e.target.value || undefined
                }))
              }
            >
              <option value="">Non assegnato</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Stato
            <select
              value={draft.status}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  status: e.target.value as TaskStatus
                }))
              }
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {draft.startDate && draft.endDate && (
            <div className="info-box">
              <strong>Periodo schedulato:</strong>
              <p>
                {draft.startDate} → {draft.endDate}
              </p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>
            Annulla
          </button>
          <button className="primary" onClick={handleSave}>
            Salva modifiche
          </button>
        </div>
      </div>
    </div>
  );
}
