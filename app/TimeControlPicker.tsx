"use client";

import { TIME_CONTROLS, type TimeControlId } from "@/src/timecontrol";

// A compact preset grid (lichess-style): the six time-control chips in one
// multi-column grid that fills the dialog width. No per-category header rows —
// "3+2", "10+5", "Untimed" are self-describing to the audience, so the labels
// would be redundant chrome (DESIGN.md "Forms, controls & pickers (HCI)":
// recognition-over-recall + signal-to-noise). Chips stay in category/duration
// order so the grouping still reads left-to-right. Selected chip is marked by a
// NEUTRAL highlight + aria-checked, never a reserved game-state color.

export function TimeControlPicker({
  value,
  onChange,
}: {
  value: TimeControlId;
  onChange: (id: TimeControlId) => void;
}) {
  return (
    <div className="tc-grid" role="radiogroup" aria-label="Time control">
      {TIME_CONTROLS.map((t) => (
        <button
          type="button"
          key={t.id}
          role="radio"
          aria-checked={value === t.id}
          aria-label={`${t.label} (${t.category})`}
          className={value === t.id ? "tc-option on" : "tc-option"}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
