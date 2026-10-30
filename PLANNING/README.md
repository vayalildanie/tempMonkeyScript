# PLANNING

Design specs, implementation plans, and execution reports for tempMonkeyScript.
Nothing here is loaded by the userscript.

## Proposed — Submit Check remark gate

| Document | What it is |
|---|---|
| `specs/2026-10-29-submit-check-non3-remarks-design.md` | Proposed likely `v1.5.3`: hold submission when a populated non-3 score has an empty remark, and make Escape unfocus a selected remark textbox. Not approved and not on `main`. |

## v1.5.2 — remark click selection

| Document | What it is |
|---|---|
| `specs/2026-10-29-v1.5.2-remark-click-selection-design.md` | The approved design: delegated click selection, direct-edit synchronization, and existing arrow eligibility |
| `plans/2026-10-29-v1.5.2-remark-click-selection.md` | The implementation plan, including its regression and release tasks |
| `reports/v1.5.2/ledger.md` | Implementation evidence, independent review, rulings, deferred test improvements, and live smoke checklist (96 tests passing) |

## v1.5.0 — annotation UI adaptation

| Document | What it is |
|---|---|
| `specs/2026-10-29-v1.5.0-annotation-ui-adaptation-design.md` | The design and the confirmed decisions (initial target, first-`↑` jump, `Q` routing, title-click removal) |
| `plans/2026-10-29-v1.5.0-annotation-ui-adaptation.md` | The task plan, with the per-task commit table and the live-page checklist at the top |
| `reports/v1.5.0/task-1-report.md` … `task-6-report.md` | Each implementer's report: what was built, red/green test evidence, concerns. Fix rounds are appended at the end of each file |
| `reports/v1.5.0/final-fix-report.md` | The fix wave after the whole-branch review |
| `reports/v1.5.0/final-review.md` | Summary of the whole-branch review and how each finding was resolved |
| `reports/v1.5.0/ledger.md` | The execution ledger: pre-flight scan, every ruling made on your behalf (with what it costs if wrong), deferred minors |

## Earlier

| Document | What it is |
|---|---|
| `specs/2026-08-27-v1.4.1-closed-state-pills-design.md` | v1.4.1 design |
| `plans/2026-08-27-v1.4.1-closed-state-pills.md` | v1.4.1 plan |
| `plans/2026-09-10-v1.5-testing-and-histo-db-roadmap.md` | Older scoping roadmap. The test-infrastructure half is superseded by the v1.5.0 plan; Module 4 (Histo_DB) is planned for **v1.6** |
