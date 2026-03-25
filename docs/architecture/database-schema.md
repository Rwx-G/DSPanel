# Database Schema

DSPanel uses SQLite (via the rusqlite crate) for local-only storage (audit log, snapshots, settings). No server database. Database migrations are managed in `src-tauri/src/db/migrations.rs` and run at application startup.

```sql
-- Audit Log
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    user_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_object TEXT,
    details TEXT,  -- JSON
    result TEXT NOT NULL CHECK (result IN ('Success', 'Failure', 'DryRun')),
    error_message TEXT
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_user ON audit_log(user_name);
CREATE INDEX idx_audit_action ON audit_log(action_type);
CREATE INDEX idx_audit_target ON audit_log(target_object);

-- Object Snapshots
CREATE TABLE object_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    object_dn TEXT NOT NULL,
    object_type TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    attributes TEXT NOT NULL,  -- JSON
    created_by TEXT NOT NULL
);

CREATE INDEX idx_snapshot_dn ON object_snapshots(object_dn);
CREATE INDEX idx_snapshot_timestamp ON object_snapshots(timestamp);

-- Scheduled Reports
CREATE TABLE scheduled_reports (
    id TEXT PRIMARY KEY,  -- UUID
    name TEXT NOT NULL,
    report_type TEXT NOT NULL,
    parameters TEXT NOT NULL,  -- JSON
    frequency TEXT NOT NULL,  -- daily/weekly/monthly
    output_format TEXT NOT NULL,
    output_path TEXT,
    last_run TEXT,
    next_run TEXT,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL
);

-- Risk Score History
CREATE TABLE risk_score_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    total_score INTEGER NOT NULL,
    factor_scores TEXT NOT NULL  -- JSON
);
```

---
