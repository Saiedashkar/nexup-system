// Runs before every test file's module graph (vitest setupFiles), so the
// app's Prisma pool is constructed against the isolated test database
// with TLS disabled — never against .env's Supabase host.
const BASE = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5435";
process.env.DATABASE_URL = `${BASE}/capital_test`;
process.env.DATABASE_SSL_DISABLE = "1";
