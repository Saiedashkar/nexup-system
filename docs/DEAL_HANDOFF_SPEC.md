# Deal hand-off — from the sales room to a client and a project

**Status:** specification only. **Nothing in this document is implemented.** No write route was added,
called or exercised in this round; the sales room remains a demo surface and the two bound pages remain
read-only.

---

## 1. The goal

The sales room closes a deal. This is the smallest honest path from *that deal* to a `Client` row and a
`ProjectRecord` row in the company the session belongs to — with no invented fields and no cross-company
write.

```
sales room (deal)  ──►  pre-flight read  ──►  one atomic write  ──►  the two bound pages show it
   accepted offer        client exists?         client + project       (already implemented)
                         price & deposit        + pool transaction
```

---

## 2. What the deal must carry

| Field | Required | Source in the room | Target |
|---|---|---|---|
| company | yes | the session (never the UI control) | `businessId` on both rows |
| client name | yes | the deal's contact | `Client.name` |
| client phone | yes | the deal's contact | `Client.phone` (unique per business) |
| project name | yes | the accepted offer's title | `ProjectRecord.projectName` |
| agreed price | yes, > 0 | the accepted offer's total | `totalPrice` |
| deposit | no, ≥ 0 | the offer's paid-now term | `deposit` |
| date | yes | the day the deal is accepted | `date` |
| services | no | the offer's line items | `ServiceType` ids **or** `customServiceText` |
| notes | no | the room's closing note | `notes` |

Derived, never supplied by the room: `remaining = totalPrice − deposit`, `paymentStatus`
(`FULL` when `deposit ≥ totalPrice`, `PARTIAL` when `deposit > 0`, else `UNPAID`), client `tier`.

Fields the room must **not** send, because nothing stores them: owner, industry, "client since", health
score, progress, missions, agents. If the room shows them, that is display-only and must not cross the
boundary.

---

## 3. Pre-flight (read, then decide)

1. `GET /api/auth/me` → the session's `businessId`. Reject when it is `"all"` or absent (see G3 below).
2. Look the client up inside **that** business: `(businessId, phone)`. Three outcomes:
   * exists and is live → attach the project to it, and update `name` only if the deal's spelling differs;
   * exists but soft-deleted → **revive** it (the unique index is on `(businessId, phone)`, so inserting
     would collide);
   * does not exist → create it with `tier: NORMAL`.
3. Reject a duplicate hand-off: same client, same project name, same agreed price, within a short window
   → return the existing project instead of creating a second one.

## 4. The write (one transaction)

| # | Effect | Note |
|---|---|---|
| 1 | `Client` create / revive / rename | per business; phone is the key |
| 2 | `ProjectRecord` create | `businessId` from the session, `clientId` from step 1 |
| 3 | `PoolTransaction` `IN` when `deposit > 0` | the existing create path already does this |
| 4 | `Client.tier` recompute | VIP `> 1000` revenue or `≥ 3` projects; LOYAL `> 500` or `≥ 2`; else NORMAL |
| 5 | `ActivityLog` `CREATE` | actor = `session.userId` |

All five commit together or not at all. The response is the created record, so the caller can open
`/command/projects#<id>` immediately.

## 5. Permissions

* `EMPLOYEE` may not hand off: the existing write routes answer `403` for that role, and the deal room
  should say so before the button is pressed.
* `ADMIN` writes only inside its own `businessId`.
* `SUPER_ADMIN` writes into a **chosen** company — which means the room must supply the company id, and
  the route must refuse the literal `"all"`.

## 6. Gaps this hand-off depends on

| id | Gap | What the hand-off needs |
|---|---|---|
| **G3** | `POST /api/projects` writes `session.businessId`, i.e. `"all"` for a super admin | a resolved company id, refused when it is `"all"` |
| **G1** | `/api/clients` recomputes `tier` and shadows the stored column | either the surface stops calling it `tier`, or the write path and the read path agree on one definition |
| **G4** | `/api/projects` does two extra queries per row | a create that returns a single record is unaffected; the list will be slower as the table grows |

## 7. Out of scope for this spec

Invoicing, subscriptions, instalments, EGP/SAR conversion, portal invitations, and anything that would
message the client. They are separate decisions with separate money implications.

## 8. Acceptance criteria (when it is built)

1. A closed deal in company A produces exactly one client and one project, both with `businessId = A`.
2. A second hand-off of the same deal produces no duplicate row.
3. A client that already exists in company A with the same phone is reused, not duplicated.
4. Nothing is written when the session is `EMPLOYEE`, when the session is gone (`401`), or when the deal
   lacks a required field (`400`).
5. Immediately after a successful hand-off, `/command/clients` and `/command/projects` show the new rows
   and their figures include them — no reload of anything but the two reads.
6. Every field shown on the resulting project card exists in the row the write created.
