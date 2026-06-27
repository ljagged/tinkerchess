// REGRESSION GATE (plan Stage 1, decision 3). The Convex validators in schema.ts
// mirror the engine's plain-data unions BY HAND. `matches`/`moves` are append-only
// replay history, so if a validator and its TS union drift, a stored game is
// rejected on write or misread on replay (failure mode "schema drift").
//
// This test pins that mirror three ways:
//   1. structural parity — the validator's discriminant set and each variant's field
//      set equal the engine's (catches a field added to the type but not the validator);
//   2. sample acceptance — a representative value of every variant validates;
//   3. negative cases — a foreign `kind` or an extra field is rejected.
//
// Adding a catalog entry to Action/GameEvent (a new mechanic) MUST add its variant
// here, or this test fails — that is the point.

import { describe, it, expect } from "vitest";
import { recordedActionV, gameEventV, gameStateV, setupConfigV } from "./schema.js";
import type { GameEvent } from "../src/engine/index.js";

// --- a faithful interpreter of a Convex validator's structural JSON --------------
// Mirrors Convex's own acceptance: literals match by value, objects reject EXTRA
// fields and require non-optional ones, unions accept if any member does.
type VJson = { type: string; value?: unknown; fieldType?: VJson; optional?: boolean };

function accepts(vj: VJson, value: unknown): boolean {
  switch (vj.type) {
    case "any":
      return true;
    case "null":
      return value === null;
    case "number":
    case "int64":
      return typeof value === "number" || typeof value === "bigint";
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "literal":
      return value === vj.value;
    case "array":
      return Array.isArray(value) && value.every((el) => accepts(vj.value as VJson, el));
    case "union":
      return (vj.value as VJson[]).some((m) => accepts(m, value));
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      const fields = vj.value as Record<string, { fieldType: VJson; optional: boolean }>;
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (!(key in fields)) return false; // extra field — Convex rejects these
      }
      for (const [key, spec] of Object.entries(fields)) {
        if (!(key in obj)) {
          if (!spec.optional) return false;
          continue;
        }
        if (!accepts(spec.fieldType, obj[key])) return false;
      }
      return true;
    }
    default:
      throw new Error(`unhandled validator node type: ${vj.type}`);
  }
}

/** The set of `kind` literals a discriminated-union validator accepts. */
function discriminants(vj: VJson): Set<string> {
  const out = new Set<string>();
  for (const member of vj.value as VJson[]) {
    const fields = (member as VJson).value as Record<string, { fieldType: VJson }>;
    const k = fields?.kind?.fieldType;
    if (k?.type === "literal") out.add(String(k.value));
  }
  return out;
}

/** The declared field names of the union member whose `kind` literal is `kind`. */
function fieldsOf(vj: VJson, kind: string): Set<string> {
  for (const member of vj.value as VJson[]) {
    const fields = (member as VJson).value as Record<string, { fieldType: VJson }>;
    if (fields?.kind?.fieldType?.type === "literal" && fields.kind.fieldType.value === kind) {
      return new Set(Object.keys(fields));
    }
  }
  throw new Error(`no member with kind=${kind}`);
}

const recordedJson = (recordedActionV as unknown as { json: VJson }).json;
const eventJson = (gameEventV as unknown as { json: VJson }).json;
const stateJson = (gameStateV as unknown as { json: VJson }).json;
const setupJson = (setupConfigV as unknown as { json: VJson }).json;

/** Field name → { optional } for an object validator. */
function objectFieldSpec(vj: VJson): Record<string, { optional: boolean }> {
  const fields = vj.value as Record<string, { optional: boolean }>;
  const out: Record<string, { optional: boolean }> = {};
  for (const [k, spec] of Object.entries(fields)) out[k] = { optional: spec.optional };
  return out;
}

describe("validator parity — recordedActionV mirrors the engine Action union", () => {
  it("has exactly the engine's action discriminants", () => {
    expect(discriminants(recordedJson)).toEqual(new Set(["move", "phaseOut"]));
  });

  it("each variant declares exactly the engine's stored fields", () => {
    // Recorded form (games.ts): move flattens Move (incl. the Chess960 castle flag);
    // phaseOut flattens PhaseOut.
    expect(fieldsOf(recordedJson, "move")).toEqual(new Set(["kind", "from", "to", "promotion", "castle"]));
    expect(fieldsOf(recordedJson, "phaseOut")).toEqual(new Set(["kind", "from", "duration"]));
  });

  it("accepts a representative value of every variant", () => {
    expect(accepts(recordedJson, { kind: "move", from: 12, to: 28 })).toBe(true);
    expect(accepts(recordedJson, { kind: "move", from: 52, to: 60, promotion: "q" })).toBe(true);
    expect(accepts(recordedJson, { kind: "move", from: 4, to: 7, castle: "K" })).toBe(true); // 960 king-onto-rook
    expect(accepts(recordedJson, { kind: "phaseOut", from: 1, duration: 2 })).toBe(true);
  });

  it("rejects foreign kinds and extra fields", () => {
    expect(accepts(recordedJson, { kind: "boost", from: 1, to: 2 })).toBe(false);
    expect(accepts(recordedJson, { kind: "move", from: 1, to: 2, bogus: true })).toBe(false);
    expect(accepts(recordedJson, { kind: "move", from: 1, to: 2, promotion: "k" })).toBe(false);
  });
});

describe("validator parity — gameEventV mirrors the engine GameEvent union", () => {
  it("has exactly the engine's event discriminants", () => {
    expect(discriminants(eventJson)).toEqual(new Set(["move", "phaseOut", "phaseIn"]));
  });

  it("each variant declares exactly the engine's event fields", () => {
    expect(fieldsOf(eventJson, "move")).toEqual(
      new Set(["kind", "color", "piece", "from", "to", "capture", "enPassant", "castle", "promotion", "check", "checkmate"]),
    );
    expect(fieldsOf(eventJson, "phaseOut")).toEqual(
      new Set(["kind", "color", "piece", "from", "duration", "returnOn"]),
    );
    expect(fieldsOf(eventJson, "phaseIn")).toEqual(
      new Set(["kind", "color", "piece", "to", "capture", "selfCapture", "selfDestruct", "check", "checkmate"]),
    );
  });

  it("accepts a representative value of every variant (incl. all optional flags)", () => {
    const samples: GameEvent[] = [
      { kind: "move", color: "w", piece: "n", from: 1, to: 18 },
      { kind: "move", color: "w", piece: "p", from: 51, to: 59, promotion: "q", check: true },
      { kind: "move", color: "b", piece: "p", from: 35, to: 28, capture: { color: "w", type: "p" }, enPassant: true },
      { kind: "move", color: "w", piece: "k", from: 4, to: 6, castle: "K", checkmate: true },
      { kind: "phaseOut", color: "w", piece: "b", from: 5, duration: 3, returnOn: 4 },
      { kind: "phaseIn", color: "w", piece: "r", to: 0 },
      { kind: "phaseIn", color: "w", piece: "r", to: 0, capture: { color: "b", type: "n" }, check: true },
      { kind: "phaseIn", color: "w", piece: "n", to: 4, selfDestruct: true },
      { kind: "phaseIn", color: "b", piece: "q", to: 59, selfCapture: true },
    ];
    for (const s of samples) expect(accepts(eventJson, s)).toBe(true);
  });

  it("rejects a foreign event kind", () => {
    expect(accepts(eventJson, { kind: "boostGranted", color: "w", piece: "q", from: 1, to: 2 })).toBe(false);
  });
});

describe("validator parity — gameStateV carries the moddable axes (decision 3 + 4)", () => {
  it("declares the named moddable fields, all optional for back-compat", () => {
    const fields = objectFieldSpec(stateJson);
    expect(fields.mechanics).toEqual({ optional: true });
    expect(fields.setup).toEqual({ optional: true });
    expect(fields.castlingHomeFiles).toEqual({ optional: true });
    expect(fields.schemaVersion).toEqual({ optional: true });
    // config stays phasing's RuleConfig (named-fields approach), still optional.
    expect(fields.config).toEqual({ optional: true });
  });

  it("setupConfigV mirrors the engine SetupConfig (id + optional position)", () => {
    expect(objectFieldSpec(setupJson)).toEqual({
      id: { optional: false },
      position: { optional: true },
    });
    expect(accepts(setupJson, { id: "classical" })).toBe(true);
    expect(accepts(setupJson, { id: "chess960", position: 518 })).toBe(true);
    expect(accepts(setupJson, { id: "chess960", position: 518, bogus: 1 })).toBe(false);
  });

  it("accepts a stored state's moddable fields and rejects mistyped ones", () => {
    // a minimal-but-valid stored-state fragment for the new fields
    const ok = { setup: { id: "classical" }, mechanics: ["phasing"], schemaVersion: 1 };
    const fields = stateJson.value as Record<string, { fieldType: VJson; optional: boolean }>;
    expect(accepts(fields.setup.fieldType, ok.setup)).toBe(true);
    expect(accepts(fields.mechanics.fieldType, ok.mechanics)).toBe(true);
    expect(accepts(fields.schemaVersion.fieldType, ok.schemaVersion)).toBe(true);
    expect(accepts(fields.schemaVersion.fieldType, "1")).toBe(false); // not a number
    expect(accepts(fields.mechanics.fieldType, [1, 2])).toBe(false); // not strings
  });
});
