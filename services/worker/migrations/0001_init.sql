CREATE TABLE IF NOT EXISTS cases (
  case_id          TEXT    PRIMARY KEY,
  title            TEXT    NOT NULL,
  owner            TEXT    NOT NULL,
  coordinator      TEXT    NOT NULL DEFAULT '',
  contract_address TEXT    NOT NULL DEFAULT '',
  tx_hash          TEXT,
  status           TEXT    NOT NULL DEFAULT 'CREATED',
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS spans (
  case_id    TEXT    NOT NULL,
  span_id    TEXT    NOT NULL,
  parent_id  TEXT,
  requester  TEXT    NOT NULL DEFAULT '',
  provider   TEXT    NOT NULL DEFAULT '',
  obligation TEXT    NOT NULL DEFAULT '',
  bond_wei   TEXT    NOT NULL DEFAULT '0',
  status     TEXT    NOT NULL DEFAULT 'PROPOSED',
  tx_hash    TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (case_id, span_id)
);

CREATE TABLE IF NOT EXISTS activity (
  activity_id TEXT    PRIMARY KEY,
  case_id     TEXT    NOT NULL,
  span_id     TEXT,
  actor       TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  tx_hash     TEXT,
  summary     TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_updated  ON cases(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_owner    ON cases(owner);
CREATE INDEX IF NOT EXISTS idx_spans_case     ON spans(case_id);
CREATE INDEX IF NOT EXISTS idx_activity_case  ON activity(case_id, created_at DESC);
