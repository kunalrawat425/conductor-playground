/**
 * Safe migration runner — runs on deploy, skips gracefully if DATABASE_URL not set.
 * Called as prebuild step: `bun run db:migrate:safe && astro build`
 */
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("⏭️  DATABASE_URL not set — skipping migrations (local dev mode)");
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "supabase", "migrations");
const useSsl = !/localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { max: 1, ssl: useSsl ? "require" : false });

// Create tracking table if not exists
await sql`
  create table if not exists _migrations (
    name text primary key,
    applied_at timestamptz default now()
  )
`;

// Get already-applied migrations
const applied = await sql`select name from _migrations`;
const appliedSet = new Set(applied.map(r => r.name));

const files = readdirSync(migrationsDir)
  .filter(f => f.endsWith(".sql"))
  .sort();

let ran = 0;
for (const name of files) {
  if (appliedSet.has(name)) {
    continue; // Already applied, skip silently
  }

  const content = readFileSync(join(migrationsDir, name), "utf-8");
  process.stderr.write(`→ ${name} … `);

  try {
    await sql.unsafe(content);
    await sql`insert into _migrations (name) values (${name})`;
    console.error("ok");
    ran++;
  } catch (e: any) {
    const msg = e.message || "";
    // Ignore "already exists" type errors
    if (msg.includes("already exists") || msg.includes("duplicate")) {
      await sql`insert into _migrations (name) values (${name}) on conflict do nothing`;
      console.error("ok (already exists)");
      ran++;
    } else {
      console.error("FAILED:", msg);
      await sql.end({ timeout: 5 });
      process.exit(1);
    }
  }
}

await sql.end();
if (ran > 0) {
  console.error(`✅ ${ran} migration(s) applied.`);
} else {
  console.error("✅ All migrations up to date.");
}
