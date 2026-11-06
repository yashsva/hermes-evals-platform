-- Every user-editable thing (task, config, skill, and future kinds) is a versioned row.
-- Editing inserts version + 1; nothing is updated in place, so experiments can reference exact versions.
CREATE TABLE definitions (
  id          serial PRIMARY KEY,
  kind        text        NOT NULL,
  key         text        NOT NULL,
  version     integer     NOT NULL,
  name        text        NOT NULL,
  spec        jsonb       NOT NULL,
  archived    boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key, version)
);
CREATE INDEX definitions_kind_key ON definitions (kind, key, version DESC);

CREATE TABLE experiments (
  id              serial PRIMARY KEY,
  name            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'queued',
  config_a_id     integer     NOT NULL REFERENCES definitions (id),
  config_b_id     integer     NOT NULL REFERENCES definitions (id),
  task_ids        integer[]   NOT NULL,
  -- Skill keys in each config resolved to exact definition ids at creation time: {"A": [..], "B": [..]}.
  skill_ids       jsonb       NOT NULL,
  repeats         integer     NOT NULL,
  spend_cap_usd   numeric     NOT NULL,
  hermes_version  text        NOT NULL,
  -- Per-model prices used for this experiment's cost figures, captured at creation.
  prices          jsonb       NOT NULL DEFAULT '{}',
  estimate        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

-- The trials table doubles as the work queue: the runner claims 'queued' rows with SKIP LOCKED.
CREATE TABLE trials (
  id             serial PRIMARY KEY,
  experiment_id  integer     NOT NULL REFERENCES experiments (id) ON DELETE CASCADE,
  task_id        integer     NOT NULL REFERENCES definitions (id),
  config_id      integer     NOT NULL REFERENCES definitions (id),
  arm            text        NOT NULL CHECK (arm IN ('A', 'B')),
  repeat         integer     NOT NULL,
  -- Random run order so time-of-day or rate-limit effects don't line up with one arm.
  order_key      double precision NOT NULL DEFAULT random(),
  status         text        NOT NULL DEFAULT 'queued',
  attempts       integer     NOT NULL DEFAULT 0,
  score          double precision,
  final_text     text,
  exit_code      integer,
  tokens_in      integer,
  tokens_out     integer,
  tokens_cache_read integer,
  cost_usd       double precision,
  duration_ms    integer,
  error          text,
  stderr_tail    text,
  started_at     timestamptz,
  finished_at    timestamptz
);
CREATE INDEX trials_queue ON trials (status, order_key);
CREATE INDEX trials_experiment ON trials (experiment_id);

CREATE TABLE trial_events (
  id        bigserial PRIMARY KEY,
  trial_id  integer NOT NULL REFERENCES trials (id) ON DELETE CASCADE,
  seq       integer NOT NULL,
  type      text    NOT NULL,
  payload   jsonb   NOT NULL
);
CREATE INDEX trial_events_trial ON trial_events (trial_id, seq);

CREATE TABLE checks (
  id        bigserial PRIMARY KEY,
  trial_id  integer NOT NULL REFERENCES trials (id) ON DELETE CASCADE,
  position  integer NOT NULL,
  name      text    NOT NULL,
  type      text    NOT NULL,
  weight    double precision NOT NULL,
  required  boolean NOT NULL,
  passed    boolean NOT NULL,
  reason    text    NOT NULL
);
CREATE INDEX checks_trial ON checks (trial_id, position);
