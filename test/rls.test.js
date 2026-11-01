import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('prospective PostgreSQL RLS enforces owner isolation under ordinary roles', async t => {
  const db = new PGlite();
  const A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const run = '11111111-1111-4111-8111-111111111111', job = '22222222-2222-4222-8222-222222222222';
  async function asOwner(owner) {
    await db.exec('RESET ROLE');
    // TEST HARNESS ONLY: simulates gateway-verified identity, not JWT verification.
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.exec('SET ROLE authenticated');
  }
  try {
    await db.exec(`CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE s7_migration_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
    await db.exec(await readFile(new URL('../db/0001_owner_isolation.sql', import.meta.url), 'utf8'));
    await t.test('every owner table has ENABLE and FORCE plus an explicit policy', async () => {
      const flags = await db.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sector7' AND c.relkind='r'");
      assert.equal(flags.rows.length, 4);
      assert.ok(flags.rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
      assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='sector7'")).rows[0].n, 10);
    });
    await asOwner(A);
    await db.query("INSERT INTO sector7.runs(id,operation_key,status) VALUES ($1,'same-key','completed')", [run]);
    await db.query("INSERT INTO sector7.jobs(id,run_id,status) VALUES ($1,$2,'completed')", [job, run]);
    await db.query("INSERT INTO sector7.events(run_id,sequence,kind) VALUES ($1,1,'completed')", [run]);
    await db.query("INSERT INTO sector7.artifacts(id,run_id,digest,byte_count) VALUES ($1,$2,$3,12)", [job, run, 'a'.repeat(64)]);
    await t.test('another owner cannot read or change any first-owner records', async () => {
      await asOwner(B);
      for (const table of ['runs', 'jobs', 'events', 'artifacts']) assert.equal((await db.query('SELECT * FROM sector7.' + table)).rows.length, 0);
      assert.equal((await db.query("UPDATE sector7.runs SET status='failed' WHERE id=$1 RETURNING id", [run])).rows.length, 0);
      assert.equal((await db.query("UPDATE sector7.jobs SET status='failed' WHERE id=$1 RETURNING id", [job])).rows.length, 0);
      await assert.rejects(db.query("INSERT INTO sector7.runs(owner_id,id,operation_key,status) VALUES ($1,$2,'spoof','running')", [A, job]), { code: '42501' });
      await assert.rejects(db.query("INSERT INTO sector7.jobs(id,run_id,status) VALUES ($1,$2,'running')", [job, run]), { code: '23503' });
    });
    await t.test('operation keys and identifiers are unique per owner without cross-owner collision', async () => {
      await asOwner(B);
      await db.query("INSERT INTO sector7.runs(id,operation_key,status) VALUES ($1,'same-key','completed')", [run]);
      assert.equal((await db.query('SELECT * FROM sector7.runs')).rows.length, 1);
      await asOwner(A);
      assert.equal((await db.query('SELECT * FROM sector7.runs')).rows[0].status, 'completed');
    });
    await t.test('owner transfer, event edits and evidence deletion are refused', async () => {
      await asOwner(A);
      await assert.rejects(db.query('UPDATE sector7.runs SET owner_id=$1 WHERE id=$2', [B, run]), { code: '42501' });
      for (const table of ['runs', 'jobs', 'events', 'artifacts']) await assert.rejects(db.query('DELETE FROM sector7.' + table), { code: '42501' });
      await assert.rejects(db.query("UPDATE sector7.events SET kind='failed'"), { code: '42501' });
      await assert.rejects(db.query("UPDATE sector7.artifacts SET byte_count=0"), { code: '42501' });
      await assert.rejects(db.exec('ALTER TABLE sector7.runs DISABLE ROW LEVEL SECURITY'), { code: '42501' });
    });
    await t.test('missing identity and anonymous sessions cannot access owner data', async () => {
      await asOwner('');
      assert.equal((await db.query('SELECT * FROM sector7.runs')).rows.length, 0);
      await assert.rejects(db.query("INSERT INTO sector7.runs(id,operation_key,status) VALUES ($1,'no-owner','running')", [job]));
      await db.exec('RESET ROLE; SET ROLE anon');
      await assert.rejects(db.query('SELECT * FROM sector7.runs'), { code: '42501' });
    });
    await t.test('absent mutation policies still deny deletion and evidence editing if grants drift', async () => {
      await db.exec('RESET ROLE; GRANT DELETE ON ALL TABLES IN SCHEMA sector7 TO authenticated; GRANT UPDATE ON sector7.events, sector7.artifacts TO authenticated');
      await asOwner(A);
      for (const table of ['runs', 'jobs', 'events', 'artifacts']) assert.equal((await db.query('DELETE FROM sector7.' + table + ' RETURNING owner_id')).rows.length, 0);
      assert.equal((await db.query("UPDATE sector7.events SET kind='failed' RETURNING owner_id")).rows.length, 0);
      assert.equal((await db.query('UPDATE sector7.artifacts SET byte_count=0 RETURNING owner_id')).rows.length, 0);
    });
    await t.test('a non-superuser table owner is subject to forced RLS too', async () => {
      await db.exec('RESET ROLE; GRANT USAGE ON SCHEMA sector7 TO s7_migration_owner; ALTER TABLE sector7.runs OWNER TO s7_migration_owner; SET ROLE s7_migration_owner');
      assert.equal((await db.query('SELECT * FROM sector7.runs')).rows.length, 0);
    });
  } finally { await db.close(); }
});
