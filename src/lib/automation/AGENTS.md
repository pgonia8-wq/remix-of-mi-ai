# Automation rules (Block 4)

- `tools.ts` is the only tool registry; `invokeTool()` order is fixed: registry → task allowlist → role → project policy → zod input → call limits → budget (unknown cost follows run policy, never invented) → availability → exact-action approval → checkpoint → run → observation. Why: model output (JSON or native tool calls) never grants permissions.
- Approvals bind a SHA-256 fingerprint of run, task, tool, canonical params, target and cost; any change needs a new approval; uses are counted. Why: no stale or widened authorization.
- Orchestrator persists each model decision as a `decision` checkpoint before acting and keys tool calls by task/attempt/turn; interrupted side effects become `uncertain` and require human review. Why: no repeated billing or duplicate external effects after a crash.
- Calls are counted before sending and refunded only for `NoRequestSent`/`BudgetError`. Why: honest consumption.
- The auditor cannot approve tasks that ran code/tests without a later-unfailed `passed` evidence row; evidence statuses are passed/failed/not_run/blocked/simulated. Why: builder claims are not proof.
- File locks (`file_locks`) are taken for declared files and on first write of undeclared files. Why: no concurrent edits of one file.
- Working memory is scrubbed of secrets, bounded by folding old observations, and renders external content inside `<datos_no_confiables>`. Why: prompt-injection containment.
- Triggers (`triggers.ts`) only create review items; `schedules.start` refuses `auto:` schedules. Why: alarms never execute billed actions.
- Model access is injectable (`ModelCall`); tests use scripted responses and must say so. Why: logic is testable without credentials, and simulation is never reported as real provider validation.
- Runs without a PC folder use the phone workspace (`local-workspace.ts`, project-scoped SQLite tables) through the same fs.* tools; phone quality runs only self-contained JS in QuickJS and records native checks as `blocked`. Why: agents work independently of a PC/VM without faking builds.
- Planner/replanner only offer tools whose availability passes in the run's environment; `agents.delegate` is chat-only (role `chat`). Why: models must not plan around unavailable tools or recurse delegation.
- `drive.ts` is the only background driver and calls `stepRun`; chat-delegated runs render as `[[miai-run:id]]` cards. Why: runs advance on their own while all execution stays in the orchestrator.
