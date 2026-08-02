import { useState } from "react";
import { PartyPopper, Sparkles, Trash2 } from "lucide-react";
import { api } from "../api";
import type { Todo, TripDetail } from "../types";

const CATS = ["general", "booking", "documents", "packing", "money"];

export default function TodosTab({ detail, refresh }: { detail: TripDetail; refresh: () => Promise<void> }) {
  const { trip, todos } = detail;
  const [text, setText] = useState("");
  const [cat, setCat] = useState("general");
  const [due, setDue] = useState("");

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
    return (
      // Four stable children, so a phone can lay the row out as "task on top, its category
      // and date underneath" — squeezed onto one line the task text lost to the controls.
      <div className={`todo${t.done ? " done" : ""}`} key={t.id}>
        <span className="todo-lead">
          <input type="checkbox" checked={!!t.done} onChange={() => patch(t, { done: t.done ? 0 : 1 })} />
          {t.source === "ai" && <Sparkles size={11} className="ai-mark" aria-label="Extracted by AI from your conversation" />}
        </span>
        <input
          dir="auto" className="subtle todo-text" defaultValue={t.text}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onBlur={(e) => e.target.value.trim() && e.target.value !== t.text && patch(t, { text: e.target.value })}
        />
        <span className="todo-meta">
          <select className="subtle" value={t.category} onChange={(e) => patch(t, { category: e.target.value })}>
            {CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input
            type="date" className="subtle nowrap" defaultValue={t.due_date ?? ""}
            onBlur={(e) => e.target.value !== (t.due_date ?? "") && patch(t, { due_date: e.target.value || null })}
          />
        </span>
        <button className="icon-del" onClick={() => remove(t)} aria-label={`Delete "${t.text}"`}><Trash2 size={15} /></button>
      </div>
    );
  }

  return (
    <div className="pad narrow">
      <h2>Todo list</h2>
      <div className="add-row">
        <input dir="auto" placeholder="e.g. Book Airbnb in Kyoto" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="primary" onClick={add}>Add</button>
      </div>

      <div className="todo-list-wide">{open.map(renderTodo)}</div>
      {open.length === 0 && <p className="hint icon-line"><PartyPopper size={13} /> Nothing left to do</p>}

      {done.length > 0 && <h3>Done</h3>}
      <div className="todo-list-wide">{done.map(renderTodo)}</div>
    </div>
  );
}
