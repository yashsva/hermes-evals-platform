# Known limits

## What the numbers can and can't say

- **Small task sets give wide intervals.** With 12 tasks, only large effects can be told apart from noise. Smaller real effects will show as *Inconclusive*, which is the correct answer, not a bug. As a rough guide, the interval's half-width is about 2 × (standard deviation of per-task deltas) / √(number of tasks). To halve it, you need four times as many tasks.
- **Results hold for this task set, model and Hermes version only.** Experiments record the Hermes version and the exact definition versions, but a provider can change a model behind the same name.
- **Repeats estimate noise but are not a power analysis.** Three repeats steady each task's mean. They do not add evidence about other tasks.
- **A near-deterministic model makes the A/A test weak.** In the sample run, every repeat of every task scored the same. The A/A test then proves the wiring is correct, but not that the platform copes with noise.
- **Percentile bootstrap intervals are slightly too narrow for very few tasks** (fewer than about 10). The UI shows the number of tasks next to every interval.
- **No correction for multiple comparisons.** If you run many experiments and look for a "Better", some will be flukes.

## Grading

- **Checks are deterministic, so they measure contracts, not quality.** They test the right value, the required format, and whether a hidden test passes. Prose quality and open-ended answers can't be scored. There is no LLM judge (deliberately, for cost and noise reasons; it would be a new definition kind).
- **A strict format check can fail a correct answer.** In the ACME tasks that is the construct under test. Each task also has a format-independent "correct value" check, so the inspector separates *wrong* from *right but unformatted*.
- **Script checks run author-supplied code** inside the app container. That is fine for one trusted user, but it would need real sandboxing for a multi-user deployment.

## Execution

- **Isolation is at container level.** The agent runs shell commands with `--yolo` inside the app container, as the unprivileged `hermes` user, with CPU and memory limits. It can reach the network, which it needs for the model API.
- **A crash or timeout scores 0.** Infrastructure failures are mixed into the quality score on purpose, so the config that fails more doesn't look better. The status (`error`) and error message tell them apart, and provider rate limits are retried first.
- **The spend cap can be overshot by up to the cost of the trials already running** (at most `WORKER_CONCURRENCY` trials), because a cap is checked before each trial starts.
- **Costs are an upper bound.** All input tokens are priced at the full input rate, ignoring cache-read discounts. They come from OpenRouter list prices, not invoices.
- **Hermes leaves a gateway daemon behind after every chat.** The adapter kills it by matching the trial's `HERMES_HOME` (this reads `/proc`, so it only works on Linux, which means inside the container). A future Hermes version that changes how the gateway is launched would need re-checking: watch the app container's memory.
- **Docker Desktop may not survive host sleep.** On macOS, a Mac that sleeps mid-run can leave the VM unresponsive, and Docker Desktop then has to be restarted. Trials that were running are re-queued on boot, so no result is lost or double-counted. For long runs, keep the Mac awake (`caffeinate`).
- **Single node, single user, no authentication.** Throughput is limited by `WORKER_CONCURRENCY` (default 2) and provider rate limits.
- **Hermes is pinned to v0.22.7.** Its `config.yaml` keys and its stream-json format are external contracts. A Hermes upgrade needs the adapter tests re-run.

## Scope

- **Memory is supported but not measured.** Configs can seed `MEMORY.md` and enable the memory tool, but the sample experiment doesn't test whether memory helps. Testing "learns across sessions" would need multi-session tasks.
- **Two configs per experiment.** There is no N-way leaderboard.
- **Workspace files are text only** (no binary fixtures), up to 100 KB each.
- **The fake runner (`RUNNER=fake`) is a development tool.** Its results are clearly labelled and are never evidence.
