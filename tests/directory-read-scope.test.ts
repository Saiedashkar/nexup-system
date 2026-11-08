/**
 * ONE SCOPE RULE FOR BOTH READ ROUTES, AND A SEPARATE ONE FOR WRITES.
 *
 * `/api/clients` and `/api/projects` used to resolve the session's companies
 * differently. These tests pin the shared rule down for sessions of two
 * companies: what each may read, what each may write, and the fact that a read
 * scope never becomes a write scope.
 */

import { describe, expect, it } from "vitest";

import {
  readScopeSlugs,
  resolveWriteScope,
  type ScopedSession,
} from "@/lib/read-scope";

const session = (over: Partial<ScopedSession> = {}): ScopedSession => ({
  userId: "u1",
  role: "ADMIN",
  businessId: "biz-nexup",
  canAccessNexup: true,
  canAccessRebound: false,
  canAccessAbomazen: false,
  ...over,
});

const employeeNexup = session({
  userId: "emp-a",
  role: "EMPLOYEE",
  businessId: "biz-nexup",
});

const adminNexupAndAbomazen = session({
  userId: "adm-a",
  role: "ADMIN",
  businessId: "biz-nexup",
  canAccessNexup: true,
  canAccessAbomazen: true,
});

const adminAbomazen = session({
  userId: "adm-b",
  role: "ADMIN",
  businessId: "biz-abomazen",
  canAccessNexup: false,
  canAccessAbomazen: true,
});

const superAdmin = session({
  userId: "root",
  role: "SUPER_ADMIN",
  businessId: "all",
  canAccessNexup: true,
  canAccessRebound: true,
  canAccessAbomazen: true,
});

describe("read scope", () => {
  it("gives a super admin every company", () => {
    const scope = readScopeSlugs(superAdmin);
    expect(scope.mode).toBe("all");
    expect(scope.slugs.sort()).toEqual(["abomazen", "nexup", "rebound"]);
  });

  it("gives a single-company session exactly that company", () => {
    expect(readScopeSlugs(employeeNexup)).toEqual({ mode: "companies", slugs: ["nexup"] });
    expect(readScopeSlugs(adminAbomazen)).toEqual({ mode: "companies", slugs: ["abomazen"] });
  });

  it("gives a session as many companies as its flags grant", () => {
    expect(readScopeSlugs(adminNexupAndAbomazen).slugs.sort()).toEqual(["abomazen", "nexup"]);
  });

  it("gives a session with no flags nothing to read", () => {
    const none = session({ canAccessNexup: false, canAccessRebound: false, canAccessAbomazen: false });
    expect(readScopeSlugs(none)).toEqual({ mode: "companies", slugs: [] });
  });

  it("keeps the two companies' read sets apart", () => {
    const a = readScopeSlugs(employeeNexup).slugs;
    const b = readScopeSlugs(adminAbomazen).slugs;
    expect(a.filter((slug) => b.includes(slug))).toEqual([]);
  });
});

describe("write scope", () => {
  it("refuses an employee outright", () => {
    expect(resolveWriteScope(employeeNexup)).toEqual({
      ok: false,
      status: 403,
      error: "Access denied",
    });
  });

  it("writes inside the session's own company when no company is named", () => {
    expect(resolveWriteScope(session())).toEqual({
      ok: true,
      businessId: "biz-nexup",
      explicit: false,
    });
  });

  it("refuses a company the session does not carry", () => {
    expect(resolveWriteScope(session(), "biz-abomazen")).toEqual({
      ok: false,
      status: 403,
      error: "Access denied",
    });
  });

  it("never turns a multi-company read scope into a multi-company write scope", () => {
    const read = readScopeSlugs(adminNexupAndAbomazen);
    expect(read.slugs).toHaveLength(2);
    expect(resolveWriteScope(adminNexupAndAbomazen)).toEqual({
      ok: true,
      businessId: "biz-nexup",
      explicit: false,
    });
  });

  it("makes a session that spans companies name one, and refuses the literal 'all'", () => {
    expect(resolveWriteScope(superAdmin).ok).toBe(false);
    expect(resolveWriteScope(superAdmin, "all")).toEqual({
      ok: false,
      status: 400,
      error: "businessId is required: this session spans every company",
    });
    expect(resolveWriteScope(superAdmin, "biz-abomazen")).toEqual({
      ok: true,
      businessId: "biz-abomazen",
      explicit: true,
    });
  });

  it("refuses a session that carries no company at all", () => {
    const noCompany = session({ businessId: "" });
    expect(resolveWriteScope(noCompany)).toEqual({
      ok: false,
      status: 400,
      error: "This session carries no company",
    });
  });
});
