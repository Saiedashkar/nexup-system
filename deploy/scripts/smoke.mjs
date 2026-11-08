#!/usr/bin/env node
/**
 * SMOKE — the running production build, exercised over HTTP.
 *
 *   BASE_URL=http://127.0.0.1:3311 TRIAL_EMAIL=owner@trial.local TRIAL_PASSWORD=… \
 *   BUSINESS_ID=<uuid> node deploy/scripts/smoke.mjs [--allow-writes]
 *
 * Without `--allow-writes` it checks the TRIAL shape: sign in, read clients and
 * projects, and confirm that every write and every external-execution surface is
 * refused by the middleware lock (`TRIAL_READ_ONLY=1`).
 *
 * With `--allow-writes` it also creates one project through the real handler —
 * the evidence that the lock, not a broken route, is what refuses the trial.
 *
 * It prints PASS/FAIL per check and exits non-zero on the first failing suite; it
 * never prints the password or the session cookie.
 */

const base = (process.env.BASE_URL || "").replace(/\/$/, "");
const email = process.env.TRIAL_EMAIL || "";
const password = process.env.TRIAL_PASSWORD || "";
const businessId = process.env.BUSINESS_ID || "";
const allowWrites = process.argv.includes("--allow-writes");

if (!base || !email || !password) {
  console.error("BASE_URL, TRIAL_EMAIL and TRIAL_PASSWORD are required.");
  process.exit(2);
}

const rows = [];
let failed = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    rows.push([name, "PASS", detail ?? ""]);
  } catch (error) {
    failed += 1;
    rows.push([name, "FAIL", error instanceof Error ? error.message : String(error)]);
  }
}

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const json = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`expected JSON, got ${text.slice(0, 120)}`);
  }
};

const call = (path, init = {}) =>
  fetch(`${base}${path}`, { redirect: "manual", ...init });

let cookie = "";

async function main() {
  await check("GET /login is 200", async () => {
    const response = await call("/login");
    expect(response.status === 200, `status ${response.status}`);
    return "200";
  });

  await check("POST /api/auth/login sets a session", async () => {
    const response = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await json(response);
    expect(response.status === 200, `status ${response.status} ${JSON.stringify(body)}`);
    const jar = response.headers.getSetCookie().map((c) => c.split(";")[0]).filter(Boolean);
    cookie = jar.join("; ");
    expect(cookie.includes("nexup_session="), "no session cookie");
    expect(body.user?.email ?? body.user?.name, "no user in the body");
    return `role=${body.user.role}`;
  });

  const authed = (path, init = {}) => call(path, { ...init, headers: { ...(init.headers ?? {}), cookie } });

  await check("GET /api/auth/me", async () => {
    const response = await authed("/api/auth/me");
    const body = await json(response);
    expect(response.status === 200, `status ${response.status}`);
    return `role=${body.user?.role} scope=${body.user?.scope?.mode}`;
  });

  await check("GET /api/clients reads rows", async () => {
    const response = await authed("/api/clients");
    const body = await json(response);
    expect(response.status === 200, `status ${response.status}`);
    expect(Array.isArray(body), "not an array");
    return `${body.length} client(s)`;
  });

  await check("GET /api/projects reads rows", async () => {
    const response = await authed("/api/projects");
    const body = await json(response);
    expect(response.status === 200, `status ${response.status}`);
    expect(Array.isArray(body), "not an array");
    return `${body.length} project(s)`;
  });

  await check("GET /api/office/stats", async () => {
    const response = await authed("/api/office/stats");
    const body = await json(response);
    expect(response.status === 200, `status ${response.status}`);
    return `businesses=${body.businesses?.length} clients=${body.stats?.totalClients}`;
  });

  for (const page of ["/command/clients", "/command/projects"]) {
    await check(`GET ${page} renders`, async () => {
      const response = await authed(page);
      const html = await response.text();
      expect(response.status === 200, `status ${response.status}`);
      expect(html.includes("<html"), "not an HTML document");
      return `${html.length} bytes`;
    });
  }

  const newProject = () => ({
    businessId,
    clientPhone: "0555000",
    clientName: "عميل التجربة",
    projectName: "مشروع التجربة",
    date: "2026-11-09",
    totalPrice: 1200,
    deposit: 200,
  });

  if (allowWrites) {
    await check("POST /api/projects creates one project (writes enabled)", async () => {
      expect(businessId, "BUSINESS_ID is required with --allow-writes");
      const response = await authed("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProject()),
      });
      const body = await json(response);
      expect(response.status === 201, `status ${response.status} ${JSON.stringify(body)}`);
      const projects = await json(await authed("/api/projects"));
      expect(projects.some((p) => p.id === body.id), "the new project is not in the list");
      return `created ${body.id}, list now ${projects.length}`;
    });
  } else {
    await check("POST /api/projects is refused by the trial lock", async () => {
      const response = await authed("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProject()),
      });
      const body = await json(response);
      expect(response.status === 403, `status ${response.status}`);
      expect(body.error === "This trial is read-only.", `body ${JSON.stringify(body)}`);
      return "403 This trial is read-only.";
    });

    for (const [path, method] of [
      ["/api/clients/client-should-not-exist", "DELETE"],
      ["/api/projects/project-should-not-exist", "DELETE"],
    ]) {
      await check(`${method} ${path} is refused by the trial lock`, async () => {
        const response = await authed(path, { method });
        expect(response.status === 403, `status ${response.status}`);
        return "403";
      });
    }

    for (const [path, method] of [
      ["/api/exec/turn", "POST"],
      ["/api/ai-workforce/health", "GET"],
      ["/api/ai-workforce/jobs", "POST"],
    ]) {
      await check(`${method} ${path} is closed (external execution)`, async () => {
        const response = await authed(path, {
          method,
          headers: { "Content-Type": "application/json" },
          body: method === "POST" ? JSON.stringify({}) : undefined,
        });
        const body = await json(response);
        expect(response.status === 403, `status ${response.status}`);
        expect(
          body.error === "External execution is disabled in this trial.",
          `body ${JSON.stringify(body)}`,
        );
        return "403 external execution disabled";
      });
    }
  }

  await check("POST /api/auth/logout", async () => {
    const response = await authed("/api/auth/logout", { method: "POST" });
    expect(response.status === 200, `status ${response.status}`);
    return "200";
  });

  await check("signed out, a command page redirects to /login", async () => {
    const response = await call("/command/projects");
    expect(response.status === 307, `status ${response.status}`);
    const location = response.headers.get("location") ?? "";
    expect(location.includes("/login"), `location ${location}`);
    return location.replace(base, "");
  });

  await check("signed out, /api/clients is 401", async () => {
    const response = await call("/api/clients");
    expect(response.status === 401, `status ${response.status}`);
    return "401";
  });
}

main()
  .then(() => {
    const width = Math.max(...rows.map(([name]) => name.length));
    console.log("");
    for (const [name, verdict, detail] of rows) {
      console.log(`  ${verdict}  ${name.padEnd(width)}  ${detail}`);
    }
    console.log("");
    console.log(`  ${rows.length - failed}/${rows.length} checks passed${allowWrites ? " (writes enabled)" : " (trial read-only)"}`);
    console.log("");
    process.exitCode = failed === 0 ? 0 : 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
