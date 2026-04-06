/**
 * Runs supabase/migrations/*.sql in lexical order against DATABASE_URL.
 *
 * Set DATABASE_URL in .env (Supabase → Project Settings → Database → URI).
 * Use the direct connection (port 5432, host db.<ref>.supabase.co), not pooler, for DDL.
 *
 * Optional: MIGRATE_ONLY=008,009,010 bun run scripts/run-migrations.ts
 *   runs only files whose names start with those prefixes (comma-separated).
 */
import postgres from "postgres";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(import.meta.dirname, "..", "supabase", "migrations");

const only = process.env.MIGRATE_ONLY?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (only?.length) {
  files = files.filter((f) => only.some((p) => f.startsWith(p)));
  if (files.length === 0) {
    console.error("No migration files matched MIGRATE_ONLY=", only.join(","));
    process.exit(1);
  }
}

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error(`Missing DATABASE_URL.

Add to .env (from Supabase Dashboard → Settings → Database → Connection string → URI):
  DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

Then: bun run db:migrate

If your database already has tables from an older setup, 001 may fail with "already exists".
Use incremental mode, e.g. only latest columns:
  MIGRATE_ONLY=010 bun run db:migrate
`);
  process.exit(1);
}

const useSsl = !/localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { max: 1, ssl: useSsl ? "require" : false });

console.error(`Running ${files.length} file(s) from supabase/migrations/ …`);

for (const name of files) {
  const path = join(migrationsDir, name);
  process.stderr.write(`→ ${name} … `);
  try {
    await sql.file(path);
    console.error("ok");
  } catch (e) {
    console.error("FAILED\n", e);
    await sql.end({ timeout: 5 });
    process.exit(1);
  }
}

await sql.end();
console.error("All migrations finished.");
