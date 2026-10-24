/**
 * Cairn v1 Schema（design D3）。
 * 边界划分基于 M0 存储批证据（artifacts/m0/delegated/work/storage-schema），
 * 按本变更规格补充 project/agent、conflict、tombstone、import_item、
 * plan_operation、device_installation、audit_event 与通用 outbox_job。
 * 约定：时间一律 ISO-8601 UTC 字符串；hash 一律小写 hex sha256；布尔用 0/1。
 */

export const MIGRATION_001_CORE = /* sql */ `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE project (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  aliases    TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE agent (
  id         TEXT PRIMARY KEY,
  label      TEXT,
  kind       TEXT NOT NULL DEFAULT 'generic',
  created_at TEXT NOT NULL
);

CREATE TABLE device (
  id                TEXT PRIMARY KEY,
  label             TEXT,
  instance_nonce    TEXT NOT NULL,
  enrollment        TEXT NOT NULL CHECK (enrollment IN ('pending','active','suspended','revoked')),
  enrolled_at       TEXT NOT NULL,
  suspended_reason  TEXT
);

CREATE TABLE space (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  space_kind    TEXT NOT NULL CHECK (space_kind IN ('personal','project','custom')),
  project_id    TEXT REFERENCES project(id),
  created_at    TEXT NOT NULL,
  CHECK (space_kind <> 'project' OR project_id IS NOT NULL)
);

-- 作用域是物理边界，不是 UI 过滤（构想 §7.5）
CREATE TABLE scope (
  id                TEXT PRIMARY KEY,
  space_id          TEXT NOT NULL REFERENCES space(id) ON DELETE RESTRICT,
  preset            TEXT NOT NULL CHECK (preset IN (
                      'personal-global','device-local','project-global','project-device',
                      'agent-private','session-ephemeral','custom')),
  scope_kind        TEXT NOT NULL CHECK (scope_kind IN ('personal','project','agent','device','custom')),
  project_id        TEXT REFERENCES project(id),
  device_id         TEXT NOT NULL DEFAULT 'all',
  agent_id          TEXT NOT NULL DEFAULT 'all',
  read_allowlist    TEXT NOT NULL DEFAULT '[]',
  sync_policy       TEXT NOT NULL CHECK (sync_policy IN ('local_only','encrypted')),
  read_policy       TEXT NOT NULL CHECK (read_policy IN ('all_agents','allowlist')),
  retention_policy  TEXT NOT NULL CHECK (retention_policy IN ('permanent','ttl','lru','session')),
  projection_policy TEXT NOT NULL CHECK (projection_policy IN ('none','allowlist')),
  sensitivity       TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive')),
  ttl_days          INTEGER,
  builtin           INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_at        TEXT NOT NULL,
  CHECK (scope_kind <> 'project' OR project_id IS NOT NULL),
  CHECK (scope_kind <> 'device' OR sync_policy = 'local_only'),
  CHECK (sync_policy <> 'encrypted' OR device_id = 'all'),
  CHECK (retention_policy <> 'ttl' OR ttl_days IS NOT NULL),
  CHECK (sensitivity <> 'sensitive' OR sync_policy = 'local_only')
);

CREATE TABLE memory (
  id                     TEXT PRIMARY KEY,
  owner_id               TEXT NOT NULL,
  kind                   TEXT NOT NULL CHECK (kind IN
                           ('instruction','preference','fact','decision','episode','procedure','environment')),
  content                TEXT NOT NULL,
  normalized_content     TEXT NOT NULL,
  scope_id               TEXT NOT NULL REFERENCES scope(id) ON DELETE RESTRICT,
  status                 TEXT NOT NULL CHECK (status IN
                           ('candidate','active','conflicted','superseded','archived','tombstoned')),
  authority              TEXT NOT NULL CHECK (authority IN
                           ('user_explicit','user_confirmed','agent_inferred','imported_unverified')),
  confidence             REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  source_agent           TEXT,
  source_session_id      TEXT,
  source_import_batch_id TEXT,
  source_message_range   TEXT,
  observed_at            TEXT NOT NULL,
  valid_from             TEXT,
  valid_to               TEXT,
  last_verified_at       TEXT,
  last_used_at           TEXT,
  expires_at             TEXT,
  sensitivity            TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive','blocked')),
  current_revision_id    TEXT REFERENCES memory_revision(id) DEFERRABLE INITIALLY DEFERRED,
  content_hash           TEXT NOT NULL,
  created_by             TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  -- instruction 只能来自用户明确输入或用户确认（构想 §8.1）
  CHECK (kind <> 'instruction' OR authority IN ('user_explicit','user_confirmed'))
);

CREATE TABLE memory_revision (
  id                  TEXT PRIMARY KEY,
  memory_id           TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  seq                 INTEGER NOT NULL CHECK (seq >= 1),
  parent_revision_ids TEXT NOT NULL DEFAULT '[]',
  content             TEXT NOT NULL,
  content_hash        TEXT NOT NULL,
  scope_id            TEXT NOT NULL REFERENCES scope(id) ON DELETE RESTRICT,
  status              TEXT NOT NULL,
  authority           TEXT NOT NULL,
  author              TEXT NOT NULL,
  device_id           TEXT NOT NULL,
  reason              TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (memory_id, seq)
);

CREATE TABLE evidence (
  id                TEXT PRIMARY KEY,
  memory_id         TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  revision_id       TEXT REFERENCES memory_revision(id) ON DELETE SET NULL,
  evidence_kind     TEXT NOT NULL CHECK (evidence_kind IN
                      ('message_range','file_ref','import_ref','url','tool_output','user_statement')),
  source_agent      TEXT,
  session_id        TEXT,
  import_archive_id TEXT,
  locator           TEXT,
  excerpt_hash      TEXT,
  trust_level       TEXT NOT NULL CHECK (trust_level IN
                      ('authoritative','user_supplied','third_party','untrusted')),
  created_at        TEXT NOT NULL,
  CHECK (evidence_kind <> 'import_ref' OR import_archive_id IS NOT NULL)
);

CREATE TABLE relation (
  id             TEXT PRIMARY KEY,
  from_memory_id TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  to_memory_id   TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  relation_type  TEXT NOT NULL CHECK (relation_type IN ('supersedes','contradicts','related_to')),
  created_at     TEXT NOT NULL,
  CHECK (from_memory_id <> to_memory_id),
  UNIQUE (from_memory_id, to_memory_id, relation_type)
);

-- 并发双方证据队列（memory-governance spec：不做字段级 LWW）
CREATE TABLE conflict (
  id               TEXT PRIMARY KEY,
  memory_id        TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  base_revision_id TEXT REFERENCES memory_revision(id),
  revision_a_id    TEXT NOT NULL REFERENCES memory_revision(id),
  revision_b_id    TEXT NOT NULL REFERENCES memory_revision(id),
  detected_at      TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN
                     ('open','resolved_keep_a','resolved_keep_b','resolved_keep_both','resolved_manual')),
  resolved_at      TEXT,
  resolution_note  TEXT,
  UNIQUE (memory_id, revision_a_id, revision_b_id)
);

-- 可审计遗忘：内容停止使用但不物理消失；物理 purge 是独立维护操作
CREATE TABLE tombstone (
  id           TEXT PRIMARY KEY,
  memory_id    TEXT NOT NULL REFERENCES memory(id) ON DELETE RESTRICT,
  reason       TEXT,
  forgotten_by TEXT NOT NULL,
  forgotten_at TEXT NOT NULL,
  content_hash TEXT NOT NULL
);

CREATE TABLE import_archive (
  id                  TEXT PRIMARY KEY,
  batch_id            TEXT NOT NULL,
  source_kind         TEXT NOT NULL CHECK (source_kind IN
                        ('markdown','jsonl','agent_memory_file','manual_export')),
  source_locator_hash TEXT NOT NULL,
  source_label        TEXT,
  byte_size           INTEGER NOT NULL CHECK (byte_size >= 0),
  content_hash        TEXT NOT NULL,
  snapshot_path       TEXT NOT NULL,
  parser              TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN
                        ('stored','partially_indexed','indexed','rejected','quarantined')),
  redaction_state     TEXT NOT NULL CHECK (redaction_state IN
                        ('not_scanned','scanned_clean','scanned_blocked')),
  discovered_at       TEXT NOT NULL,
  imported_at         TEXT,
  UNIQUE (source_locator_hash, content_hash)
);

CREATE TABLE import_item (
  id           TEXT PRIMARY KEY,
  archive_id   TEXT NOT NULL REFERENCES import_archive(id) ON DELETE CASCADE,
  item_index   INTEGER NOT NULL CHECK (item_index >= 0),
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  byte_offset  INTEGER,
  source_ref   TEXT,
  scan_state   TEXT NOT NULL CHECK (scan_state IN ('pending','clean','blocked')),
  scan_findings TEXT,
  batch_id     TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (archive_id, item_index)
);

CREATE TABLE onboarding_plan (
  id                 TEXT PRIMARY KEY,
  plan_hash          TEXT NOT NULL,
  scope_id           TEXT NOT NULL REFERENCES scope(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL CHECK (status IN
                       ('draft','awaiting_approval','approved','applied','expired','invalidated','rejected')),
  source_archive_ids TEXT NOT NULL DEFAULT '[]',
  item_count         INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  proposed_by        TEXT NOT NULL,
  model_provider     TEXT,
  created_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  applied_at         TEXT
);

-- 计划操作：每个操作绑定目标修订快照，应用时重检（任务 3.1/3.3）
CREATE TABLE plan_operation (
  id                      TEXT PRIMARY KEY,
  plan_id                 TEXT NOT NULL REFERENCES onboarding_plan(id) ON DELETE CASCADE,
  op_index                INTEGER NOT NULL CHECK (op_index >= 0),
  op_type                 TEXT NOT NULL CHECK (op_type IN ('add','merge','keep_both','skip')),
  target_memory_id        TEXT REFERENCES memory(id),
  target_expected_revision TEXT,
  item_id                 TEXT REFERENCES import_item(id),
  content                 TEXT,
  content_hash            TEXT,
  scope_id                TEXT REFERENCES scope(id),
  kind                    TEXT CHECK (kind IS NULL OR kind IN
                            ('instruction','preference','fact','decision','episode','procedure','environment')),
  reason                  TEXT,
  merged_from             TEXT,
  idempotency_key         TEXT NOT NULL UNIQUE,
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                            ('pending','applied','skipped','failed')),
  applied_at              TEXT,
  error                   TEXT,
  UNIQUE (plan_id, op_index)
);

CREATE TABLE approval (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES onboarding_plan(id) ON DELETE CASCADE,
  plan_hash   TEXT NOT NULL,
  approved_by TEXT NOT NULL CHECK (approved_by IN ('user','local_cli','mcp_ui')),
  channel     TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  uses        INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses)
);

CREATE UNIQUE INDEX approval_live_unique ON approval(plan_id) WHERE revoked_at IS NULL;

-- 后台任务本地可靠边界（design D9）；上行任务受作用域触发器物理排除
CREATE TABLE outbox_job (
  id              TEXT PRIMARY KEY,
  job_type        TEXT NOT NULL CHECK (job_type IN
                    ('sync_upstream','extract','embed','maintain','projection_rebuild')),
  scope_id        TEXT REFERENCES scope(id) ON DELETE RESTRICT,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('memory','revision','plan','archive','system')),
  entity_id       TEXT NOT NULL,
  payload         TEXT NOT NULL DEFAULT '{}',
  payload_hash    TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL CHECK (status IN
                    ('pending','running','done','retry','failed','dead','conflict')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts    INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_attempt_at TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (status <> 'dead' OR attempts >= 1)
);

CREATE TABLE managed_block (
  id           TEXT PRIMARY KEY,
  target_path  TEXT NOT NULL,
  block_id     TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content      TEXT NOT NULL,
  start_marker TEXT NOT NULL,
  end_marker   TEXT NOT NULL,
  backup_path  TEXT,
  installed_at TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  removed_at   TEXT,
  UNIQUE (target_path, block_id),
  CHECK (start_marker <> end_marker)
);

-- 宿主配置安装所有权记录（plan → apply → doctor → uninstall）
CREATE TABLE device_installation (
  id           TEXT PRIMARY KEY,
  agent_kind   TEXT NOT NULL,
  home_root    TEXT NOT NULL,
  config_path  TEXT NOT NULL,
  target_hash  TEXT NOT NULL,
  backup_path  TEXT,
  plan_id      TEXT,
  installed_at TEXT NOT NULL,
  removed_at   TEXT,
  UNIQUE (agent_kind, home_root, config_path)
);

-- 本地审计事件（design D10）：不记录记忆正文与秘密
CREATE TABLE audit_event (
  id           TEXT PRIMARY KEY,
  at           TEXT NOT NULL,
  category     TEXT NOT NULL,
  action       TEXT NOT NULL,
  subject_type TEXT,
  subject_id   TEXT,
  detail       TEXT NOT NULL DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- 触发器：数据库层兜底的安全边界
-- ---------------------------------------------------------------------------

-- local_only 或设备限定内容绝不产生上行任务（spec scoped-retrieval）
CREATE TRIGGER outbox_reject_local_upstream
BEFORE INSERT ON outbox_job
WHEN NEW.job_type = 'sync_upstream' AND NEW.scope_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'scope_not_upstreamable')
  WHERE (SELECT sync_policy FROM scope WHERE id = NEW.scope_id) <> 'encrypted'
     OR (SELECT device_id   FROM scope WHERE id = NEW.scope_id) <> 'all';
END;

-- 命中秘密扫描的正文在写入时拒绝，而不是打码后继续（构想 §12.3）
CREATE TRIGGER memory_reject_blocked_insert
BEFORE INSERT ON memory
WHEN NEW.sensitivity = 'blocked'
BEGIN
  SELECT RAISE(ABORT, 'sensitivity_blocked_refused');
END;

CREATE TRIGGER memory_reject_blocked_update
BEFORE UPDATE OF sensitivity ON memory
WHEN NEW.sensitivity = 'blocked'
BEGIN
  SELECT RAISE(ABORT, 'sensitivity_blocked_refused');
END;

-- 计划哈希变化使在途审批失效（memory-governance spec：批准后计划被修改）
CREATE TRIGGER plan_hash_change_revokes_approval
AFTER UPDATE OF plan_hash ON onboarding_plan
WHEN OLD.plan_hash <> NEW.plan_hash
BEGIN
  UPDATE approval
     SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE plan_id = NEW.id AND revoked_at IS NULL;
  UPDATE onboarding_plan
     SET status = 'invalidated'
   WHERE id = NEW.id AND status IN ('approved','awaiting_approval');
END;

-- 已应用计划不允许再次变更哈希（应用后不可篡改历史）
CREATE TRIGGER plan_applied_immutable
BEFORE UPDATE OF plan_hash ON onboarding_plan
WHEN OLD.status = 'applied' AND NEW.plan_hash <> OLD.plan_hash
BEGIN
  SELECT RAISE(ABORT, 'applied_plan_immutable');
END;

-- ---------------------------------------------------------------------------
-- 索引
-- ---------------------------------------------------------------------------
CREATE INDEX memory_scope_status ON memory(scope_id, status);
CREATE INDEX memory_kind_status  ON memory(kind, status);
CREATE INDEX memory_expiry       ON memory(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX memory_updated      ON memory(updated_at);
CREATE INDEX memory_hash         ON memory(content_hash);
CREATE INDEX memory_source_batch ON memory(source_import_batch_id);
CREATE INDEX revision_memory_seq ON memory_revision(memory_id, seq);
CREATE INDEX evidence_memory     ON evidence(memory_id);
CREATE INDEX evidence_archive    ON evidence(import_archive_id);
CREATE INDEX relation_from       ON relation(from_memory_id);
CREATE INDEX relation_to         ON relation(to_memory_id);
CREATE INDEX conflict_memory     ON conflict(memory_id, status);
CREATE INDEX tombstone_memory    ON tombstone(memory_id);
CREATE INDEX archive_batch       ON import_archive(batch_id);
CREATE INDEX import_item_batch   ON import_item(batch_id);
CREATE INDEX import_item_archive ON import_item(archive_id, scan_state);
CREATE INDEX plan_status_expiry  ON onboarding_plan(status, expires_at);
CREATE INDEX plan_op_plan        ON plan_operation(plan_id, op_index);
CREATE INDEX plan_op_status      ON plan_operation(plan_id, status);
CREATE INDEX approval_plan       ON approval(plan_id, revoked_at);
CREATE INDEX outbox_ready        ON outbox_job(status, next_attempt_at) WHERE status IN ('pending','retry');
CREATE INDEX outbox_entity       ON outbox_job(entity_type, entity_id);
CREATE INDEX managed_block_target ON managed_block(target_path, block_id);
CREATE INDEX device_install_target ON device_installation(agent_kind, home_root, config_path);
CREATE INDEX audit_at            ON audit_event(at);
`;

export const MIGRATION_002_SEARCH = /* sql */ `
-- 检索索引（design D5）：FTS5 trigram 服务三字及以上子串与拉丁文本；
-- 两字中文短查询由检索层走带界 LIKE 回退。memory.content 始终是原文事实源。
CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  content='memory',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER memory_fts_ai AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER memory_fts_ad AFTER DELETE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER memory_fts_au AFTER UPDATE OF content ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`;
