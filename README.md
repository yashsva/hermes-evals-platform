# Agent Evals

A local platform for answering one question with evidence: **when we change an AI agent's model, add a skill or turn on memory, does it get better, worse, or stay the same — and how sure are we?**

It runs [Hermes Agent](https://github.com/NousResearch/hermes-agent) on a set of tasks under two configurations, grades every run with deterministic checks, compares the configurations with a paired bootstrap confidence interval, and lets you open any single run to see exactly why it passed or failed.

Stack: NestJS + Vue 3 + TypeScript, Postgres, Hermes Agent v0.22.7 (pinned image).

**Walkthrough video:** [watch on Google Drive](https://drive.google.com/file/d/1568O2U7wxqL92ynGK37-JG0ua5kRXoOa/view?usp=sharing)

## Quick start

Requirements: Docker (Desktop) with ~4 GB memory, and an [OpenRouter](https://openrouter.ai/keys) API key.

```bash
cp .env.example .env        # then set OPENROUTER_API_KEY=...
docker compose up -d        # first run pulls the ~4.5 GB Hermes image
open http://localhost:3001
```

On first boot the database is migrated and seeded with the sample task set (12 tasks, 1 skill, 3 configs).

To run the sample experiment: **Experiments → New experiment**, choose *Baseline* as A and *Baseline + ACME skill* as B, keep all 12 tasks and 3 repeats, and start. It runs 72 trials (about 20 minutes and $0.09, measured with the seeded model `anthropic/claude-haiku-5.5`). Results of that run: [docs/EXPERIMENT.md](docs/EXPERIMENT.md).

Ports are configurable in `.env` (`APP_PORT`, default 3001; `DB_PORT`, default 5433).

## What you can do

| | Where |
|---|---|
| Define tasks (prompt, starting files, scoring checks) | **Tasks** — create/edit in the UI; every save is a new version |
| Define agent configs (model, toolsets, skills, memory, max turns) | **Configs** |
| Define skills (SKILL.md procedures configs can preload) | **Skills** |
| Run tasks under two configs, N repeats, with a cost estimate and spend cap | **Experiments → New** |
| See whether B beats A and how confident we can be | Experiment page → **Verdict** |
| Inspect one run: checks with reasons, final answer, full tool-call trajectory | Click any score chip |

## How a result should be read

> *B (Baseline + ACME skill) scores 0.29 higher than A (Baseline) on average (95% CI +0.14 to +0.45, 12 tasks). The interval is entirely above 0: B is better on this task set.*

(The real result of the sample experiment.)

- The number is the mean, over tasks, of (B's average score − A's average score) on that task.
- The interval is a paired bootstrap over tasks. If it includes 0, the verdict is **inconclusive** — the platform refuses to declare a winner.
- Runs that crash or time out score 0 and stay in the average.
- The verdict is only shown once every trial has finished.

See [docs/DESIGN.md](docs/DESIGN.md) for the reasoning.

## Development

```bash
pnpm install
docker compose up -d db                    # Postgres on localhost:5433
RUNNER=fake pnpm dev                       # API :3001 + Vue dev server :5180 (simulated agent runs)
pnpm test                                  # unit + integration tests (needs the db container)
pnpm typecheck
```

`RUNNER=fake` simulates agent runs so the UI can be developed without spending money. Fake results are labelled in the UI and are never evidence. Real runs need the Hermes image, so run them through `docker compose`.

## Repository layout

```
packages/shared/      Zod schemas for every definition kind (task, config, skill) + API types, used by both apps
apps/api/             NestJS: definitions CRUD, experiments, runner (Hermes adapter), grading, stats
  src/db/migrations/  plain SQL migrations, applied on boot
  seed/               the sample task set (inserted into an empty database)
apps/web/             Vue 3 UI
docker/app.Dockerfile Hermes image + the platform
docs/                 design, limits, costs, experiment results
```

## Documentation

- [docs/DESIGN.md](docs/DESIGN.md) — architecture, key decisions, assumptions
- [docs/LIMITS.md](docs/LIMITS.md) — known limits
- [docs/COSTS.md](docs/COSTS.md) — what running this costs
- [docs/EXPERIMENT.md](docs/EXPERIMENT.md) — results of the skill-ablation experiment
