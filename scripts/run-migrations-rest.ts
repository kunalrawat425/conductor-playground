/**
 * Run SQL migrations via Supabase REST API (no direct DB connection needed).
 * Uses SUPABASE_URL + SUPABASE_SERVICE_KEY from env.
 *
 * Usage:
 *   bun run scripts/run-migrations-rest.ts
 *   MIGRATE_ONLY=015,016 bun run scripts/run-migrations-rest.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(import.meta.dirname, "..", "supabase", "migrations");

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseServiceKey);

// Track applied migrations
const TRACKING_TABLE = `
  create table if not exists _migrations (
    name text primary key,
    applied_at timestamptz default now()
  );
`;

const only = process.env.MIGRATE_ONLY?.split(",").map(s => s.trim()).filter(Boolean);

let files = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();

if (only?.length) {
  files = files.filter(f => only.some(p => f.startsWith(p)));
}

console.error(`Found ${files.length} migration file(s)`);

// Ensure tracking table exists
try {
  await sb.rpc("exec_sql", { query: TRACKING_TABLE });
} catch {
  // If exec_sql doesn't exist, we'll check another way
}

// Check which migrations already ran
const migRes = await sb.from("_migrations").select("name");
const applied = migRes.error ? null : migRes.data;
const appliedSet = new Set((applied || []).map((r: { name: string }) => r.name));

let ran = 0;
for (const name of files) {
  if (appliedSet.has(name)) {
    console.error(`⏭️  ${name} (already applied)`);
    continue;
  }

  const sql = readFileSync(join(migrationsDir, name), "utf-8");
  process.stderr.write(`→ ${name} … `);

  // Split by semicolons and run each statement
  const statements = sql
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));

  let failed = false;
  for (const stmt of statements) {
    const { error } = await sb.rpc("exec_sql", { query: stmt });
    if (error) {
      // Try direct approach for DDL
      const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: stmt }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        // Ignore "already exists" errors
        if (text.includes("already exists") || text.includes("duplicate")) {
          process.stderr.write("(exists) ");
          continue;
        }
        console.error(`FAILED: ${text}`);
        failed = true;
        break;
      }
    }
  }

  if (!failed) {
    // Record as applied
    const { error: trackErr } = await sb.from("_migrations").insert({ name });
    if (trackErr) {
      // duplicate or missing table — migration may still have run
    }
    console.error("ok");
    ran++;
  }
}

console.error(`Done. ${ran} migration(s) applied.`);
