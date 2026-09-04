// Ambient (global) geometry types shared across both the legacy global-script files and the
// newer ES modules (Mat2D, Transform2D). Declared here — a file with no top-level import/export
// of its own — rather than inside vector.ts, specifically so it stays visible without an import
// from every consumer regardless of whether the *declaring* file (vector.ts) is itself a module.
// A module file's own top-level declarations are private to that module unless exported; a
// separate ambient .d.ts with no imports/exports of its own remains global everywhere, module
// files included — see BACKLOG.md's AFF-1 note for how this was first relied on for Mat2D/XY.

interface XY {
  x: number;
  y: number;
}

type XArg = number | XY;
