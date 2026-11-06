# Experiment: does preloading the ACME skill make the agent better?

> **Status: done (2026-11-05).** The tasks, configs and analysis were fixed before the live run, and all 12 tasks are reported. Experiment #7 is the main run and #6 the A/A check. Both can be opened in the UI.

## Question

Does preloading a procedure skill (`acme-report`) improve a Hermes agent on tasks that need that procedure, without hurting tasks that don't?

## Setup (pre-registered)

| | A: Baseline | B: Baseline + ACME skill |
|---|---|---|
| Model | anthropic/claude-haiku-5.5 (OpenRouter) | same |
| Toolsets | file, terminal | same |
| Memory | off | off |
| Max turns | 8 | 8 |
| Skills | none | `acme-report` v1 (preloaded with `-s`) |

Only one setting differs between A and B, so this is an ablation.

**Tasks (12), 3 repeats per task per config, 72 trials, in random order:**
- **6 `acme` tasks.** Each answer is in a workspace file and must be reported in the ACME-REPORT v2 format (value formats and an `EVIDENCE: file:line` citation). Each is scored by 4 checks: the correct value in any format (weight 2), the report block, the value format, and the evidence citation.
- **3 `tools` tasks.** These need the file and terminal tools but not the skill: CSV totals written to `totals.json`, fixing a `median()` bug against a hidden test, and a config lookup.
- **3 `control` tasks.** Everything needed is in the prompt. The skill should change nothing, so a drop here would mean the skill over-applies (for example, wrapping "391" in an ACME block).

**Analysis:** per-task mean score difference (B − A), paired bootstrap 95% CI over the 12 tasks, and a verdict. Also reported:
- per-tag breakdown;
- an **A/A run** (Baseline vs Baseline on all 12 tasks, 2 repeats), which must come out Inconclusive.

**Hypothesis:** B > A on `acme` tasks, B ≈ A on `tools` and `control` tasks.

## Results

### Headline

> **B (Baseline + ACME skill) scores 0.29 higher than A (Baseline) on average (95% CI +0.14 to +0.45, 12 tasks). The interval is entirely above 0: B is better on this task set.**

### Per config (36 trials each)

| | A: Baseline | B: + ACME skill |
|---|---|---|
| Mean score | 0.700 | 0.994 |
| Pass rate | 50.0% | 97.2% |
| Errors | 0 | 0 |
| Tokens in / out | 372k / 9.3k | 437k / 12.0k |
| Tokens per trial (in / out) | 10.3k / 258 | 12.1k / 333 |
| Cost | $0.042 | $0.050 |
| Median trial time | 23.2 s | 23.5 s |

The skill adds about 1.8k input tokens per trial, because its text is preloaded into the prompt. That makes B about 19% more expensive per trial.

### Per tag (mean score)

| Tag | A | B | Δ |
|---|---|---|---|
| `acme` (6 tasks) | 0.40 | 0.99 | **+0.59** |
| `tools` (3) | 1.00 | 1.00 | 0.00 |
| `control` (3) | 1.00 | 1.00 | 0.00 |

The result matches the hypothesis. The whole effect is on the tasks that need the procedure. The skill neither helped nor hurt tool use. It also did not over-apply: none of B's control answers were wrapped in an ACME block.

### Per task

| Task | A (3 repeats) | B (3 repeats) | Δ |
|---|---|---|---|
| acme-contract-date | 0.4 0.4 0.4 | 1 1 1 | +0.60 |
| acme-largest-invoice | 0.4 0.4 0.4 | 0.8 1 1 | +0.53 |
| acme-outage-date | 0.4 0.4 0.4 | 1 1 1 | +0.60 |
| acme-project-owner | 0.4 0.4 0.4 | 1 1 1 | +0.60 |
| acme-q3-emea-revenue | 0.4 0.4 0.4 | 1 1 1 | +0.60 |
| acme-refund-total | 0.4 0.4 0.4 | 1 1 1 | +0.60 |
| control-arithmetic, control-extract-city, control-json-object | 1 1 1 | 1 1 1 | 0 |
| tools-config-lookup, tools-fix-median, tools-region-totals | 1 1 1 | 1 1 1 | 0 |

### Two inspected trials

**Why A fails: trial #181 (A, acme-contract-date, 0.4).** The agent read `contracts/globex.md` and answered correctly in prose: *"The Globex Logistics vendor agreement was signed on **March 7, 2026**…"*. "Correct value (any format)" passed (weight 2 of 5). The report block, the ISO date format and the `EVIDENCE: file:line` citation all failed, because nothing told the agent about the house format. Its counterpart, trial #184 (B), read the same file once and returned a well-formed report:

```
ACME-REPORT v2
ANSWER: 2026-03-07
EVIDENCE: contracts/globex.md:5 "This agreement was signed on March 7, 2026 by both parties."
CONFIDENCE: HIGH
END-REPORT
```

All six `acme` tasks follow this pattern. **A finds the right fact every time. It misses only the procedure, and the procedure is what the skill supplies.** The format-independent check is what makes this visible: without it, A would look like it got the answers wrong.

**B's only miss: trial #190 (B, acme-largest-invoice, 0.8).** The answer `INV-1042` was right and correctly formatted. The citation was `billing/invoices.csv:2`, the first data row, but the check expects line 5, the row holding the largest invoice. The agent marked its confidence `MEDIUM`. The skill says that for MEDIUM answers (a calculation over several lines) you should *"cite the first line used"*, and the agent did exactly that. **This is an ambiguity in the skill, not a model error.** For "find the maximum", "the first line used" can mean the first row scanned or the row that holds the answer. The other two repeats chose line 5. A run like this is why per-run inspection matters: the score alone would say "the agent slipped", but the run shows that the instructions are underspecified. The fix is a skill v2 that cites the line holding the answer, followed by a rerun.

### A/A check (experiment #6)

Baseline vs Baseline on all 12 tasks, 2 repeats: 48 trials, $0.056. Result: **Δ 0.00, 95% CI +0.00 to +0.00, Inconclusive.** This is the required result: the pipeline does not invent a difference between identical configs.

It is a weak test here, though. Claude Haiku 5.5 was almost deterministic on these tasks: every repeat of every task scored the same in both arms. So this run shows the comparison is wired correctly (48 separate trials, scored per arm), but it says little about how the platform handles noisy configs. Harder or more open-ended tasks would produce variance, and that variance is what an A/A test is meant to stress.

### Cost and time

- Main run: **$0.092** for 72 trials, about $0.0013 per trial. The estimate shown before starting was $0.091, based on token history from the smoke-test trials. The token defaults alone (15k / 1.5k) would have given $0.16, an overestimate, as intended.
- A/A run: $0.056 for 48 trials.
- **Total LLM spend for the whole project: $0.26.** That covers the smoke and leak probes, the first attempt (invalidated, see below), the A/A run and the main run.
- Wall time: the A/A run took 10 min. The main run took 30 min, including about 10 min when the host Mac slept (see below). Without the sleep it would have been about 20 min, at 2 trials in parallel.

### Run log (what went wrong and how it was handled)

1. **First attempt invalidated (since deleted from the database, along with the smoke-test and leak-probe runs).** Each `hermes chat` leaves a gateway daemon of about 330 MB running. After roughly 100 trials the 4 GB container ran out of memory. That caused 6 infrastructure errors ("Gateway disconnected", stalled timeouts) and then a hang. Infrastructure errors in both arms would have contaminated the comparison, so the attempt was cancelled rather than resumed. The adapter now kills each trial's leftover processes (see DESIGN.md). After the fix, memory stayed at 0.3–0.6 GB for the full 120 trials.
2. **Host sleep during the main run.** The Mac idle-slept from 08:47 to 08:56 local time. Docker Desktop's VM did not recover and had to be restarted. Two trials that were running at the time were re-queued on boot and rerun from scratch (attempt 2). No result was counted twice. The rest of the run was done under `caffeinate`.

## Threats to validity

- **Construct.** The ACME tasks reward a house format that only the skill describes, so a large effect on them is expected *if preloading works*. What the experiment measures is whether the harness delivers the skill and the model follows it, not general intelligence. The format-independent "correct value" check isolates answer correctness from format.
- **Small n.** 12 tasks is enough to detect a large effect, but not a small one.
- **One model.** A stronger model might already follow conventions it infers, or ignore the skill.
- **Provider drift.** The model behind a name can change between runs.
- **Ceiling on tools and control tasks.** Both configs scored 1.0 on all six, so they could only detect harm, not help. They did their job as controls. A harder tool set would be needed to say anything about tool use.
- **Grader and skill disagree on one case.** The largest-invoice evidence check expects the row holding the answer, while the skill's MEDIUM rule says "first line used" (trial #190). This affects 1 of 36 B trials and moves B's mean by about 0.006.
- **Model changed from the original plan.** The plan named `openai/gpt-4.1-nano`, but the OpenRouter account could not route to it, so the configs were switched to `anthropic/claude-haiku-5.5` before any results were seen.
