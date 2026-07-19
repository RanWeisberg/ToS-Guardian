/**
 * lib/modules.ts — the frozen module-name vocabulary (CLAUDE.md §3).
 *
 * These eight names must be BYTE-IDENTICAL across the architecture PNG, the
 * `steps` trace, and every description — it's a grading requirement. Define them
 * here ONCE and import them everywhere. Never retype a module name as a string
 * literal anywhere else in the codebase.
 */

/** The eight core pipeline modules, keyed by their own frozen name. */
export const MODULES = {
  IntakeRouter: "IntakeRouter",
  DocumentResolver: "DocumentResolver",
  ClauseExtractor: "ClauseExtractor",
  CaseClassifier: "CaseClassifier",
  VersionDiffer: "VersionDiffer",
  MaterialityJudge: "MaterialityJudge",
  ReportComposer: "ReportComposer",
  StateWriter: "StateWriter",
} as const;

/** Union of the eight frozen module names, derived from MODULES. */
export type ModuleName = (typeof MODULES)[keyof typeof MODULES];
