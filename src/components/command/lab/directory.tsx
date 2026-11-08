"use client";

/**
 * NEXUP COMMAND — THE BINDING'S SHARED CHROME
 * ───────────────────────────────────────────
 * Two pages read the company's real records, so the three things that must look
 * and say the same thing on both of them live here rather than twice:
 *
 *   · the SESSION-ENDED state (a 401 is not "an error with retry" — it is a
 *     sign-in, and no row may survive it);
 *   · the SCOPE line (the company the session is allowed to read — the shell's
 *     demo scope control does not change these reads, and the page says so);
 *   · the SOURCE panel (each read answers on its own, so each one is named with
 *     its own state and its own retry).
 */

import type { MessageKey } from "@/components/command/i18n/command-locale";
import { useLocale } from "@/components/command/i18n/command-locale";
import { LabButton, Note, Pill } from "@/components/command/lab/kit";
import type { DirectoryErrorKind } from "../state/directory/api";
import { useDirectory } from "../state/directory/directory-store";

/** One message key per failure kind, so a 500 never reads like an offline tab. */
export function errorMessageKey(kind: DirectoryErrorKind | null): MessageKey {
  return `directory.error.${kind ?? "network"}` as MessageKey;
}

export function sourceErrorMessage(kind: DirectoryErrorKind | null): string {
  return errorMessageKey(kind);
}

/** The session ended mid-page: stop, say it, offer the sign-in. No rows. */
export function SessionEnded({ next }: { next: string }) {
  const { t } = useLocale();
  return (
    <div className="nl-error" role="alert">
      <h2 className="nl-error__title">{t("directory.sessionEndedTitle")}</h2>
      <p className="nl-error__body">{t("directory.sessionEndedBody")}</p>
      <LabButton href={`/login?next=${encodeURIComponent(next)}`} variant="primary">
        {t("directory.signIn")}
      </LabButton>
    </div>
  );
}

/**
 * The companies these reads are scoped to — taken from the SESSION's resolved
 * scope, which is the same set the routes filtered on, so the line cannot claim a
 * scope the rows did not come from. A session that spans companies reads "All
 * companies"; a session granted none says so instead of printing a raw id.
 */
export function DirectoryScopeLine() {
  const { t } = useLocale();
  const { session, state } = useDirectory();

  const label = (() => {
    if (!session) return state.unauthorized ? t("directory.scopeAll") : "—";
    if (session.scope) {
      if (session.scope.mode === "all") return t("directory.scopeAll");
      const names = session.scope.businesses.map((business) => business.name);
      return names.length > 0 ? names.join(" · ") : t("directory.scopeNone");
    }
    return session.business?.name ?? session.businessId;
  })();

  return (
    <div className="nl-head__meta">
      <Pill label={`${t("directory.scopeLabel")}: ${label}`} tone="--nc-cyan" />
      <Note>{t("directory.scopeHint")}</Note>
    </div>
  );
}

const SOURCE_STATE_KEY: Record<string, MessageKey> = {
  loading: "directory.sources.loading",
  ready: "directory.sources.ready",
  empty: "directory.sources.empty",
  error: "directory.sources.failed",
};

/** Each read, its own state, its own retry. */
export function DirectorySourcePanel() {
  const { t } = useLocale();
  const { state, reloadClients, reloadProjects } = useDirectory();

  const rows = [
    {
      id: "clients",
      label: t("directory.sources.clients"),
      state: state.clients.state,
      retry: reloadClients,
    },
    {
      id: "projects",
      label: t("directory.sources.projects"),
      state: state.projects.state,
      retry: reloadProjects,
    },
  ];

  return (
    <div className="nl-rows">
      {rows.map((row) => (
        <div key={row.id} className="nl-line">
          <span className="nl-line__stack">
            <span className="nl-line__title">{row.label}</span>
            <span className="nl-line__meta">
              {t(SOURCE_STATE_KEY[row.state] ?? "directory.sources.loading")}
            </span>
          </span>
          {row.state === "error" ? (
            <button type="button" className="nl-stale__retry" onClick={row.retry}>
              {t("directory.sources.retry")}
            </button>
          ) : (
            <span className="nl-line__load">
              {row.state === "ready" || row.state === "empty" ? "✓" : "…"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
