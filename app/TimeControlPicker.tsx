"use client";

import { TIME_CONTROLS, type TimeControlId } from "@/src/timecontrol";

// A compact preset grid (lichess-style): the six time-control chips in one
// multi-column grid that fills the dialog width. Each chip pairs the control
// ("3 + 2") with its game-type category ("Blitz") beneath — the lichess lobby
// pattern, so a newcomer learns what a control IS, not just its numbers. The
// category is a text label (never color-only — DESIGN.md colorblind rule). Chips
// stay in category/duration order so the grouping reads left-to-right. Selected
// chip is marked by a NEUTRAL highlight + aria-checked, never a reserved game-state
// color. (Supersedes the earlier "no category labels" call — see DESIGN.md log.)

export function TimeControlPicker({
  value,
  onChange,
}: {
  value: TimeControlId;
  onChange: (id: TimeControlId) => void;
}) {
  return (
    <div className="tc-grid" role="radiogroup" aria-label="Time control">
      {TIME_CONTROLS.map((t) => {
        // "Untimed" already names itself — the category line would just repeat it.
        const showCategory = t.category !== "Untimed";
        return (
          <button
            type="button"
            key={t.id}
            role="radio"
            aria-checked={value === t.id}
            aria-label={`${t.label} (${t.category})`}
            className={value === t.id ? "tc-option on" : "tc-option"}
            onClick={() => onChange(t.id)}
          >
            <span className="tc-time">{t.label}</span>
            {showCategory && <span className="tc-cat">{t.category}</span>}
          </button>
        );
      })}
    </div>
  );
}
