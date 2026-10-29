-- Future Supabase/PostgreSQL commissioning migration. NOT wired to the JSON runtime.
-- auth.uid() must come from the authenticated gateway, never a browser owner_id.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Trusted auth.uid() required; do not install a mock in production';
  END IF;
END $$;
CREATE SCHEMA sector7;
REVOKE ALL ON SCHEMA sector7 FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA sector7 TO authenticated;
CREATE TABLE sector7.runs (
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  id uuid NOT NULL,
  operation_key text NOT NULL CHECK (operation_key ~ '^[A-Za-z0-9_-]{1,80}$'),
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled','interrupted','timed_out')),
  payload jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(payload) <= 200000),
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, operation_key)
);
CREATE TABLE sector7.jobs (
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  id uuid NOT NULL,
  run_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled','interrupted','timed_out')),
  result jsonb CHECK (pg_column_size(result) <= 8192),
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, run_id) REFERENCES sector7.runs(owner_id, id)
);
CREATE TABLE sector7.events (
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  run_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('dispatched','accepted','completed','failed','cancelled','interrupted','timed_out')),
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(metadata) <= 8192),
  PRIMARY KEY (owner_id, run_id, sequence),
  FOREIGN KEY (owner_id, run_id) REFERENCES sector7.runs(owner_id, id)
);
CREATE TABLE sector7.artifacts (
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  id uuid NOT NULL,
  run_id uuid NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  byte_count integer NOT NULL CHECK (byte_count BETWEEN 0 AND 200000),
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, run_id) REFERENCES sector7.runs(owner_id, id)
);
ALTER TABLE sector7.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector7.runs FORCE ROW LEVEL SECURITY;
ALTER TABLE sector7.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector7.jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE sector7.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector7.events FORCE ROW LEVEL SECURITY;
ALTER TABLE sector7.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector7.artifacts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sector7 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON sector7.runs, sector7.jobs TO authenticated;
GRANT SELECT, INSERT ON sector7.events, sector7.artifacts TO authenticated;
CREATE POLICY owner_runs_read ON sector7.runs FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY owner_runs_create ON sector7.runs FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY owner_runs_update ON sector7.runs FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY owner_jobs_read ON sector7.jobs FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY owner_jobs_create ON sector7.jobs FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY owner_jobs_update ON sector7.jobs FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY owner_events_read ON sector7.events FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY owner_events_append ON sector7.events FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY owner_artifacts_read ON sector7.artifacts FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY owner_artifacts_append ON sector7.artifacts FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
-- No ordinary role may delete evidence or update events/artifacts. No views,
-- SECURITY DEFINER APIs, role grants or bypass-RLS application credentials.
COMMIT;
