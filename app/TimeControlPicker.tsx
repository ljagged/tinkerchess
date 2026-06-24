"use client";

import { TIME_CONTROLS, type TimeControlId } from "@/src/timecontrol";

// A lichess-style preset grid: presets grouped by category (Blitz / Rapid /
// Classical / Untimed), each a selectable chip. The selected chip is marked by a
// border + label state, never color alone (DESIGN.md colorblind rule). Shared by
// the home create flow and the in-game "New game" rematch chooser.

const CATEGORY_ORDER = ["Blitz", "Rapid", "Classical", "Untimed"] as const;

export function TimeControlPicker({
  value,
  onChange,
}: {
  value: TimeControlId;
  onChange: (id: TimeControlId) => void;
}) {
  return (
    <div className="tc-picker" role="radiogroup" aria-label="Time control">
      {CATEGORY_ORDER.map((cat) => {
        const items = TIME_CONTROLS.filter((t) => t.category === cat);
        if (items.length === 0) return null;
        return (
          <div className="tc-group" key={cat}>
            <div className="tc-group-label">{cat}</div>
            <div className="tc-options">
              {items.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  role="radio"
                  aria-checked={value === t.id}
                  className={value === t.id ? "tc-option on" : "tc-option"}
                  onClick={() => onChange(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
