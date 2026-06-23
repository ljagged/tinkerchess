<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Design System
Always read DESIGN.md before making any visual or UI decisions. All fonts, colors,
spacing, layout, and the fog-UI patterns are defined there. Do not deviate without
explicit user approval. Hard rule: **never encode a game state with color alone** —
every state needs a shape/border/motion cue plus a label (the primary user is colorblind).
In QA/review, flag any UI code that doesn't match DESIGN.md.
