# Design

## Problem

When we change an agent — swap the model, add a skill, turn on memory — we need to know whether it got better, worse or stayed the same, with evidence a reviewer can check. Three things make that hard:

1. **Agents are non-deterministic.** The same task can pass on one run and fail on the next, so one run per config proves nothing.
2. **Tasks vary in difficulty far more than configs vary in quality.** Averages over different task sets aren't comparable.
3. **A score without its reason is not actionable.** "62%" doesn't tell you what to fix.

The platform's answer: run the *same* tasks under both configs, several times each; grade every run with explainable checks; compare per task; report the difference with a confidence interval and a verdict that can say "inconclusive"; and keep the full trajectory of every run.

## Architecture

```
Vue 3 UI ──REST (polls every 2s while running)──► NestJS API ──► Postgres
                                                   │
   DefinitionsModule  generic, versioned CRUD for every definition kind (task, config, skill, …)
   ExperimentsModule  validate → resolve exact versions → price → refuse if over cap → insert trial matrix
   RunnerService      worker loop: claims queued trials (SKIP LOCKED), 2 at a time
     AgentAdapter ─┬─ HermesCliAdapter   spawns `hermes chat … --format stream-json`
                   └─ FakeAdapter        simulated runs for UI development and tests (never evidence)
   grading.ts         deterministic checks → score + one reason per check
   stats.ts           paired bootstrap over tasks → verdict
   PricingService     OpenRouter public price list, copied into each experiment
```

One container runs the platform **on top of the pinned Hermes image** (`nousresearch/hermes-agent:v0.22.7`); Postgres runs beside it. `docker compose up` starts both.

### Life of a trial

1. The worker claims a `queued` trial row (`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`).
2. It builds a **fresh, isolated Hermes home and workspace** for that trial under `/opt/data/trials/trial-<id>/`:
   - `home/config.yaml`: model, provider, max turns, memory on/off. Hermes' self-improvement features are switched off (background review, skill-creation and memory nudges, title generation). They add model calls, and they let a run change its own skills or memory, which would make trials neither comparable nor independent.
   - `home/skills/<key>/SKILL.md` for each skill the config preloads, at the exact version pinned by the experiment.
   - `home/memories/MEMORY.md` seeded from the config, entries separated with Hermes' `\n§\n` delimiter.
   - `workspace/`: the task's starting files. This is the agent's working directory.
3. It spawns `hermes chat -q <prompt> --format stream-json -m <model> --provider <p> -t <toolsets> --max-turns <n> --yolo [-s <skill>…]` with `HERMES_HOME` set to the trial's home. The process gets its own process group, so a timeout kills the agent and any shell commands it started.
4. It parses the JSONL stream (`tool_use`, `tool_result`, `text`, `result` with token counts) into an ordered trajectory.
5. It grades the workspace and the final answer. Hidden test scripts are written to a temp directory only now, after the agent has exited, so the agent cannot have seen them.
6. It kills any process still carrying the trial's `HERMES_HOME` (Hermes' gateway daemon outlives the chat), stores the status, score, tokens, cost, trajectory and per-check reasons in one transaction, then deletes the trial directory.

## Key decisions

| Decision | Why | Alternatives rejected |
|---|---|---|
| **Drive Hermes through its CLI** (`chat --format stream-json`) behind an `AgentAdapter` interface | Keeps TypeScript throughout. `stream-json` already gives tool calls, results, final text and tokens. The interface lets tests use a fake, and lets another harness or Hermes' HTTP mode plug in later. | Importing Hermes' Python `AIAgent` from a wrapper adds a third runtime to maintain. `batch_runner.py` hard-codes `skip_memory=True` and reports no tokens. |
| **Fresh `HERMES_HOME` + workspace per trial** | No contamination between trials, which Hermes' own docs warn about for shared homes. A config becomes *files we write*, not flags we hope behave. Re-running a trial (retry) starts clean. | One shared home would leak memory and skills across trials. |
| **Run as the image's `hermes` user, trials under `/opt/data`** | Found in the spike: the image restricts writes to `HERMES_WRITE_SAFE_ROOT=/opt/data`, and its launcher drops root to uid 10000. Directories the platform creates must belong to that user. | — |
| **No `--ignore-rules`** | Found in the spike: it also suppresses memory and preloaded skills, the very things we test. Isolation comes from the fresh home and an empty workspace instead. | — |
| **One app image FROM the Hermes image** | One command, no Python 3.14 install for the reviewer. The agent's shell commands run inside the container, which acts as the sandbox (with CPU/memory limits), not on the host. | `docker run` per trial needs the Docker socket mounted (a security hole) and is slower. |
| **Everything user-editable lives in one generic, versioned `definitions` table** (`kind, key, version, spec jsonb`) | Tasks, configs and skills are all edited in the UI, and later requirements will add more kinds. A new kind is one Zod schema, one registry line and one Vue form, with no new table, endpoint or migration. | A table and CRUD module per type means more code now and more every round. YAML files aren't editable from the browser. |
| **Immutable versions + archive** | Saving inserts version N+1. Experiments reference exact definition ids, so their results can never be silently rewritten. Archiving hides an item without breaking old experiments. | Update-in-place would let old results change meaning. Snapshot copies duplicate data. |
| **Zod schemas shared by web and API** | One definition of "valid task": the form shows inline errors and the API returns the same issues as 400s. | Duplicated validation drifts. |
| **Postgres + parameterized SQL, no ORM** | Five tables and a handful of queries: an ORM would be more code and concepts than the schema. Typed repository classes keep SQL in one place. Migrations are numbered `.sql` files applied on boot. | Prisma/Drizzle add codegen or a DSL for little gain here. SQLite would have worked, but Postgres gives `SKIP LOCKED` and is one compose service. |
| **The `trials` table is the job queue** | Durable across restarts (rows left `running` are re-queued on boot), safe with several workers, and needs no extra service. | pg-boss/BullMQ/Redis are unnecessary at this scale. |
| **Deterministic checks only** (`contains`, `regex`, `json`, hidden `script`) | Repeatable, free, and each one explains itself ("`/ANSWER:\s*2026-03-07/` did not match…"). | LLM-as-judge is noisy, biased and costs money. It is a future definition kind. |
| **Crash or timeout = score 0, kept in the average** | Dropping failed runs would flatter the config that fails more. The trial's error class keeps infrastructure failures distinguishable from wrong answers. | — |
| **Provider and gateway errors are retried** (429/5xx, "Gateway disconnected", up to `MAX_ATTEMPTS`); failures before any model call are `error`, not `failed` | A rate limit is not the agent's fault. Found in the container test: with no API key, Hermes fails before any model call, and that must not count as a wrong answer. | — |
| **Paired bootstrap over tasks → Better / Worse / Inconclusive** | Answers "better?" and "how sure?" without assuming normality. Scores are bounded and the samples are small. | A t-test assumes normal, unbounded data. Adding McNemar or Wilson intervals would mean more numbers to defend without changing the conclusion. |
| **Spend guard** | The estimate is shown before starting, and the experiment is refused if over the cap. The worker stops queueing once actual spend reaches the cap (`budget_stopped`). | — |
| **Polling, not WebSockets/SSE** | One user, a few screens. Polling keeps the server stateless. | — |

## Statistics

For an experiment with configs A and B, tasks *1…n* and *k* repeats:

1. Each trial's score is the weighted fraction of checks passed (0–1). Errors score 0.
2. For each task, average its *k* scores per arm, then compute *dᵢ = mean_B − mean_A*.
3. The point estimate is *mean(d)*.
4. **Bootstrap:** resample the *n* task deltas with replacement 10,000 times (seeded, so the same data gives the same interval), take the 2.5th and 97.5th percentiles of the resampled means. That is the 95% CI.
5. **Verdict:** the whole CI above 0 means **Better**; the whole CI below 0 means **Worse**; otherwise **Inconclusive**.

Why resample *tasks* and not trials? Repeats of one task are correlated: a hard task is hard in every repeat. Treating them as independent would shrink the interval and overstate confidence. The question we answer is "does this hold across tasks like these?", and the task is the unit of evidence. Repeats only reduce noise within each task's mean.

The **A/A test** is the platform's own sanity check: comparing a config with itself must come out Inconclusive.

## Data model

```
definitions   id, kind, key, version, name, spec jsonb, archived     unique(kind, key, version)
experiments   config_a_id, config_b_id, task_ids[], skill_ids {A,B}, repeats, spend_cap_usd,
              status, hermes_version, prices (copied at creation), estimate
trials        experiment, task_id, config_id, arm, repeat, order_key (random), status, attempts,
              score, final_text, exit_code, tokens, cost_usd, duration_ms, error, stderr_tail
trial_events  trial, seq, type, payload jsonb          (the trajectory)
checks        trial, position, name, type, weight, required, passed, reason
```

Trials run in a random order (`order_key`), so drift during a run (rate limits, provider load) doesn't line up with one arm.

## Verified Hermes behaviour (v0.22.7, from a spike against the real image)

- `hermes chat -q … --format stream-json` is one-shot when stdio isn't a TTY. It writes JSONL to stdout: `system`, `text` deltas, `tool_use`, `tool_result`, and a terminal `result` with `exit_code`, `tokens{input,output,cache_read,…}`, `duration_ms` and `error`.
- `HERMES_HOME` relocates everything Hermes writes: `memories/`, `skills/`, `sessions/`, `SOUL.md`, logs.
- Each `hermes chat` starts a gateway daemon (`gateway run --idle-exit`, about 330 MB) in its own session, so it escapes the chat's process group and outlives the chat. The first live run missed this: gateways piled up until the 4 GB container ran out of memory and stalled. Now, after each trial, the adapter kills every process whose environment carries that trial's `HERMES_HOME`, and the container runs with an init process (`init: true`) to reap orphans.
- Memory has no CLI on/off flag. It is set with `memory.memory_enabled` in `config.yaml`.
- `-s <name>` preloads a skill from `<HERMES_HOME>/skills/<name>/SKILL.md`, which has YAML frontmatter.
- A run with no credentials still emits a well-formed `result` event, with `exit_code: 1`, zero tokens and an error message.

## Assumptions

- Single user, running locally. No authentication.
- Comparisons are pairwise: two configs per experiment. An A/A test (the same config twice) is allowed.
- "Memory" means Hermes' built-in `MEMORY.md`. Configs can seed it, and that is all the platform tests about memory: whether facts that are available help (recall). It does not test whether the agent learns over sessions.
- Models come from OpenRouter, and prices from OpenRouter's public price list. Other Hermes providers can be set per config, but their cost then shows as unknown.
- Tasks don't depend on the live web. They would not be reproducible.

## Extending

- **A new definition kind** (e.g. judge rubrics, tool policies): add a Zod schema in `packages/shared/src/definitions/`, register it in `DEFINITION_KINDS`, and add a form plus a registry entry in `apps/web/src/kinds.ts`.
- **A new check type**: add a schema variant in `task.ts`, a case in `grading.ts` and fields in `TaskForm.vue`.
- **Another agent harness**: implement `AgentAdapter` (`version()`, `run()`).
