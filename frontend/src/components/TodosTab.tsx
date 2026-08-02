import { useRef, useState } from "react";
import { PartyPopper, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { api } from "../api";
import type { Todo, TripDetail } from "../types";
import { DatePicker } from "./DateRangePicker";

const CATS = ["general", "booking", "documents", "packing", "money"];

export default function TodosTab({ detail, refresh }: { detail: TripDetail; refresh: () => Promise<void> }) {
  const { trip, todos } = detail;
  const [text, setText] = useState("");
  const [cat, setCat] = useState("general");
  const [due, setDue] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  // Set by Escape so the blur that follows knows to discard rather than save.
  const cancelled = useRef(false);

  async function add() {
    if (!text.trim()) return;
    await api.post(`/trips/${trip.id}/todos`, { text, category: cat, due_date: due || null });
    setText("");
    setDue("");
    await refresh();
  }

  async function patch(t: Todo, patchObj: Partial<Todo>) {
    await api.put(`/todos/${t.id}`, patchObj);
    await refresh();
  }

  async function remove(t: Todo) {
    await api.del(`/todos/${t.id}`);
    await refresh();
  }

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  function renderTodo(t: Todo) {
    const editing = editId === t.id;
    return (
      // Four stable children — lead, task, metadata, actions — so a phone can lay the row
      // out as "task on top, its category and date underneath" without the optional AI mark
      // shifting anything.
      <div className={`todo${t.done ? " done" : ""}`} key={t.id}>
        <span className="todo-lead">
          <input type="checkbox" checked={!!t.done} onChange={() => patch(t, { done: t.done ? 0 : 1 })} />
          {t.source === "ai" && <Sparkles size={11} className="ai-mark" aria-label="Extracted by AI from your conversation" />}
        </span>

        {/* Plain text until you ask to edit it: an input can only ever show one clipped line,
            and the task is the one thing in the row that has to be readable in full. */}
        {editing ? (
          <input
            dir="auto" className="todo-text-input" defaultValue={t.text} autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              else if (e.key === "Escape") { cancelled.current = true; setEditId(null); }
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              setEditId(null);
              if (cancelled.current) { cancelled.current = false; return; }
              if (v && v !== t.text) void patch(t, { text: v });
            }}
          />
        ) : (
          <span className="todo-text" dir="auto" onDoubleClick={() => setEditId(t.id)}>{t.text}</span>
        )}

        <span className="todo-meta">
          <select className="subtle" value={t.category} onChange={(e) => patch(t, { category: e.target.value })}>
            {CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
          <DatePicker value={t.due_date} label="Due date" onChange={(v) => patch(t, { due_date: v })} />
        </span>

        <span className="todo-actions">
          <button className="icon-edit" onClick={() => setEditId(t.id)} aria-label={`Edit "${t.text}"`}>
            <Pencil size={14} />
          </button>
          <button className="icon-del" onClick={() => remove(t)} aria-label={`Delete "${t.text}"`}>
            <Trash2 size={15} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="pad narrow">
      <h2>Todo list</h2>
      <div className="add-row todo-add">
        <input
          dir="auto" className="todo-add-text" placeholder="e.g. Book Airbnb in Kyoto" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <select className="todo-add-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="todo-add-date">
          <DatePicker value={due || null} label="Due date" onChange={(v) => setDue(v || "")} />
        </span>
        <button className="fab-add" onClick={add} aria-label="Add todo" title="Add todo"><Plus size={18} /></button>
      </div>

      <div className="todo-list-wide">{open.map(renderTodo)}</div>
      {open.length === 0 && <p className="hint icon-line"><PartyPopper size={13} /> Nothing left to do</p>}

      {done.length > 0 && <h3>Done</h3>}
      <div className="todo-list-wide">{done.map(renderTodo)}</div>
    </div>
  );
}
