export type PlanGateChoice = "cancel" | "add" | "add_regen";

/**
 * Shown instead of a native confirm() when adding a place to a trip that already
 * has a generated plan (green stage).
 */
export default function ConfirmPlanDialog({ open, llmReady, onChoose }: {
  open: boolean;
  llmReady: boolean;
  onChoose: (c: PlanGateChoice) => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={() => onChoose("cancel")}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>⚠ This trip is already planned</h3>
        <p>
          Adding a place will mark the current daily plan as outdated, and the plan may
          change when it is regenerated.
        </p>
        <div className="modal-actions">
          <button className="primary" onClick={() => onChoose("add_regen")} disabled={!llmReady}
            title={llmReady ? "" : "Add an LLM key in Settings first"}>
            Add &amp; regenerate now
          </button>
          <button onClick={() => onChoose("add")}>Just add</button>
          <button onClick={() => onChoose("cancel")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
