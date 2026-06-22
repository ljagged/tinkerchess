"use client";

import { useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent } from "react";

/** Canonical form used for comparison/entry: uppercase, A–Z/0–9 only. */
export const canon = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Display form: "ABCD-EFGH". */
export function formatToken(canonical: string): string {
  const c = canon(canonical);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4, 8)}` : c;
}

const inputStyle: CSSProperties = {
  width: "5.5rem",
  textAlign: "center",
  letterSpacing: "0.25em",
  textTransform: "uppercase",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "1.2rem",
  padding: "0.5rem",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
};

/** Two 4-char fields for an 8-char token. Auto-advances, accepts pasted codes. */
export function ChunkedTokenInput({
  value,
  onChange,
  onEnter,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  const secondRef = useRef<HTMLInputElement>(null);
  const first = value.slice(0, 4);
  const second = value.slice(4, 8);

  const handlePaste = (e: ClipboardEvent) => {
    const pasted = canon(e.clipboardData.getData("text")).slice(0, 8);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    if (pasted.length >= 4) secondRef.current?.focus();
  };

  return (
    <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
      <input
        aria-label="Token part 1"
        style={inputStyle}
        value={first}
        maxLength={4}
        autoFocus={autoFocus}
        onPaste={handlePaste}
        onChange={(e) => {
          const f = canon(e.target.value).slice(0, 4);
          onChange(f + value.slice(4, 8));
          if (f.length === 4) secondRef.current?.focus();
        }}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      />
      <span style={{ color: "var(--muted)" }}>–</span>
      <input
        ref={secondRef}
        aria-label="Token part 2"
        style={inputStyle}
        value={second}
        maxLength={4}
        onPaste={handlePaste}
        onChange={(e) => onChange(value.slice(0, 4) + canon(e.target.value).slice(0, 4))}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      />
    </div>
  );
}

/** Copies `text` to the clipboard with brief "Copied!" feedback. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
