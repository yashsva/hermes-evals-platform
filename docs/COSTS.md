# Costs

## Formula

```
experiment cost ≈ tasks × 2 configs × repeats × tokens per trial × model price
```

- **Tokens per trial**: the platform uses the average from past real trials with the same model once at least 5 exist. Until then it assumes 15k input and 1.5k output tokens.
- **Prices** come from OpenRouter's public model list, fetched at experiment creation and stored with the experiment.
- **Cost figures are an upper bound**: cache-read discounts are ignored.

Before starting, every experiment shows its estimate, and the platform refuses to start if the estimate exceeds the spend cap (default $2). While it runs, it stops queueing new trials once the actual spend reaches the cap.

## Sample experiment (12 tasks × 2 configs × 3 repeats = 72 trials)

Seeded model `anthropic/claude-haiku-5.5` at OpenRouter list prices on 2026-11-04 ($0.10 / M input tokens, $0.50 / M output tokens):

| | per trial | 72 trials |
|---|---|---|
| Estimate (15k in / 1.5k out) | $0.0023 | **$0.16** |
| **Measured** (2026-11-05, experiment #7: avg 11.2k in / 296 out tokens) | **$0.0013** | **$0.092** |

Real trials used far fewer output tokens than the default assumes, so the default overestimates. Once 5 real trials exist, the platform switches to measured averages: the estimate for the main run was $0.091, and the actual cost was $0.092.

**Total LLM spend to build and evaluate this project: $0.26** (all trials, including smoke tests and one invalidated attempt; those runs have since been deleted from the database, so the UI shows only #6 and #7).

Other models at the default token counts:

| Model | $/M in / out | 72 trials |
|---|---|---|
| anthropic/claude-haiku-5.5 | 0.10 / 0.50 | ≈ $0.16 |
| openai/gpt-5-nano | 0.05 / 0.40 | ≈ $0.10 (reasoning tokens add output) |
| openai/gpt-4o-mini | 0.15 / 0.60 | ≈ $0.23 |
| openai/gpt-5-mini | 0.25 / 2.00 | ≈ $0.49 |

Prices change. The New experiment page always shows the current estimate.

## Infrastructure

- **Local:** $0. It needs Docker and about 6 GB of disk (the Hermes image is 4.5 GB). Measured idle memory is about 90 MB (app 56 MB, Postgres 31 MB). Each running trial adds one Hermes Python process. The app container is capped at 4 GB.
- **Hosted, if it ever were:** a small VM (2 vCPU / 4 GB) plus managed Postgres is roughly $20–50 per month. LLM spend dominates at any real usage.

## Time

Each trial takes about 10–40 seconds (median 23 s, measured): about 6 seconds of Hermes startup plus the model's turns. With 2 trials running in parallel, the 72-trial experiment takes about 20 minutes. Raising `WORKER_CONCURRENCY` speeds this up until provider rate limits kick in.
