/**
 * Hermes transport protocol — ADAPTER-OWNED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  PRIMARY transport: VERIFIED WebSocket JSON-RPC 2.0 (`rpc`)
 *  Quarantined   : HTTP paths + CLI subcommands (PROVISIONAL, never defaults)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The `rpc` shape is the real Hermes headless contract and is the production
 * transport. The `http` and `cli` shapes are ASSUMPTIONS kept ONLY as inactive
 * scaffolding — they are not defaults, are not reachable from the production
 * factory, and must never be presented as verified Hermes APIs. The `oneshot`
 * shape is verified but is demoted to an explicit fallback/diagnostic.
 *
 * Everything here is adapter-owned: nothing is exported from, or reachable by,
 * any generic core contract.
 */

export const HERMES_PROTOCOL_PROVISIONAL_NOTICE =
  "PROVISIONAL: these HTTP paths and CLI subcommands are assumptions only. " +
  "The real Hermes transport contract is UNVERIFIED and must be discovered before production use.";

/**
 * The ONE part of the protocol verified against a real Hermes install.
 * Hermes Agent v0.21.2 (2026.9.11): `--oneshot / -z` sends a single prompt, prints
 * ONLY the final response text to stdout, and is intended for scripts/pipes.
 * Profile selection is `-p <profile>`. See `DEFAULT_HERMES_CLI_ONESHOT_PROTOCOL`.
 */
export const VERIFIED_HERMES_ONESHOT_NOTICE =
  "VERIFIED (Hermes Agent): CLI one-shot `hermes -p <profile> -z <prompt>`, kept only as an explicit " +
  "fallback/diagnostic. The PRIMARY transport is now the verified WebSocket JSON-RPC contract below.";

/**
 * The PRIMARY Hermes transport, VERIFIED against a real Hermes install.
 *
 * Hermes' headless/backend surface is **WebSocket JSON-RPC 2.0** on `/api/ws`
 * (see `tui_gateway/ws.py`). The wire protocol is newline-delimited JSON in
 * both directions, identical to stdio:
 *
 *   request   `{"jsonrpc":"2.0","id":<id>,"method":<method>,"params":{...}}`
 *   response  `{"jsonrpc":"2.0","id":<id>,"result":{...}}`   (or an `error` object)
 *   event     `{"jsonrpc":"2.0","method":"event","params":{"type":...,"session_id":...,"payload":{...}}}`
 *
 * Responses correlate by `id`; the server emits a `gateway.ready` event right
 * after accept, and streams a turn's output as `event` notifications.
 * `/api/pub` and `/api/events` are sidecar/event surfaces (NOT prompt transport);
 * `/api/console` is console/debug/fallback (NOT the production runtime path).
 *
 * METHODS. The operator-verified method set is encoded verbatim below. Fields
 * marked `VERIFIED` were read directly from the local Hermes source
 * (`tui_gateway/methods_session.py`, `methods_prompt.py`, `server.py`). The two
 * names `gateway.ping` / `session.events.since` come from the operator's
 * verified contract but were NOT present in the locally inspected build
 * (v0.20.0) — they are carried as method NAMES only, with no invented params or
 * result fields.
 */
export const VERIFIED_HERMES_RPC_NOTICE =
  "VERIFIED: Hermes headless transport is WebSocket JSON-RPC 2.0 on `/api/ws`. Methods are encoded below; " +
  "params/result fields are only encoded where they were read from the local Hermes source.";

/* ═══════════════════════════════════════════════════════
   HTTP protocol
   ═══════════════════════════════════════════════════════

   Path templates are RELATIVE (the transport prepends the configured base
   endpoint). Recognised placeholders, already URL-encoded by the caller:
     {profile}   the addressed profile slug
     {id}        the execution id */

export type HermesHttpOperationSpec = {
  /** PROVISIONAL. HTTP method for the operation. */
  method: string;
  /**
   * PROVISIONAL. Path template relative to the base endpoint. Recognises the
   * `{profile}` and `{id}` placeholders.
   */
  path: string;
};

/**
 * PROVISIONAL. JSON field names the HTTP transport emits in the submit body.
 * Field names are also an assumption and may be overridden.
 */
export type HermesSubmitBodyMapping = {
  profile: string;
  instruction: string;
  context: string;
  correlation: string;
};

export type HermesHttpProtocol = {
  health: HermesHttpOperationSpec;
  submit: HermesHttpOperationSpec;
  status: HermesHttpOperationSpec;
  cancel: HermesHttpOperationSpec;
  resume: HermesHttpOperationSpec;
  /** PROVISIONAL. Overridable submit-body field names. */
  submitBody?: HermesSubmitBodyMapping;
};

export const DEFAULT_HERMES_SUBMIT_BODY: HermesSubmitBodyMapping = {
  profile: "profile",
  instruction: "instruction",
  context: "context",
  correlation: "correlation",
};

/**
 * PROVISIONAL DEFAULTS — assumptions, not a verified contract.
 * Replace after real Hermes contract discovery.
 */
export const DEFAULT_HERMES_HTTP_PROTOCOL: HermesHttpProtocol = {
  health: { method: "GET", path: "/v1/runtime/health?profile={profile}" },
  submit: { method: "POST", path: "/v1/runtime/jobs" },
  status: { method: "GET", path: "/v1/runtime/jobs/{id}?profile={profile}" },
  cancel: { method: "POST", path: "/v1/runtime/jobs/{id}/cancel?profile={profile}" },
  resume: { method: "POST", path: "/v1/runtime/jobs/{id}/resume?profile={profile}" },
  submitBody: DEFAULT_HERMES_SUBMIT_BODY,
};

/* ═══════════════════════════════════════════════════════
   CLI protocol
   ═══════════════════════════════════════════════════════

   The transport still spawns with an ARGUMENT ARRAY and `shell: false`; only
   the token ORDER is described here. No value is ever interpolated into a
   command string — profile and execution id remain single array elements. */

export type HermesCliOperationSpec = {
  /** PROVISIONAL. Fixed leading subcommand token(s). */
  command: readonly string[];
  /** PROVISIONAL. Flag that precedes the profile value, if any. */
  profileFlag?: string;
  /** PROVISIONAL. Flag that precedes the execution id, if any. */
  executionFlag?: string;
  /** PROVISIONAL. Literal flag emitted when the operation carries stdin. */
  stdinFlag?: string;
};

export type HermesCliProtocol = {
  health: HermesCliOperationSpec;
  submit: HermesCliOperationSpec;
  status: HermesCliOperationSpec;
  cancel: HermesCliOperationSpec;
  resume: HermesCliOperationSpec;
};

/* ═══════════════════════════════════════════════════════
   CLI one-shot protocol — VERIFIED
   ═══════════════════════════════════════════════════════

   Unlike the subcommand transport above, this shape WAS verified against a
   real Hermes install (v0.21.2): `hermes -p <profile> -z <prompt>`. The prompt
   is a SINGLE argument element — never shell-interpolated. The flag names are
   still adapter-owned config so a future Hermes version can be accommodated in
   one place. */

export type HermesCliOneshotProtocol = {
  /** VERIFIED: profile selection flag (Hermes `-p / --profile`). */
  profileFlag: string;
  /** VERIFIED: one-shot prompt flag (Hermes `-z / --oneshot`). */
  oneshotFlag: string;
};

/** VERIFIED against Hermes Agent v0.21.2 (2026.9.11). */
export const DEFAULT_HERMES_CLI_ONESHOT_PROTOCOL: HermesCliOneshotProtocol = {
  profileFlag: "-p",
  oneshotFlag: "-z",
};

/**
 * PROVISIONAL DEFAULTS — assumptions, not a verified contract.
 * Replace after real Hermes contract discovery.
 */
export const DEFAULT_HERMES_CLI_PROTOCOL: HermesCliProtocol = {
  health: { command: ["health"], profileFlag: "--profile" },
  submit: { command: ["submit"], profileFlag: "--profile", stdinFlag: "--stdin" },
  status: { command: ["status"], profileFlag: "--profile", executionFlag: "--execution" },
  cancel: { command: ["cancel"], profileFlag: "--profile", executionFlag: "--execution" },
  resume: { command: ["resume"], profileFlag: "--profile", executionFlag: "--execution" },
};

/* ═══════════════════════════════════════════════════════
   WebSocket JSON-RPC protocol — VERIFIED (primary transport)
   ═══════════════════════════════════════════════════════ */

/** The default WebSocket route (VERIFIED: `tui_gateway/ws.py` mounts `/api/ws`). */
export const HERMES_RPC_DEFAULT_PATH = "/api/ws";

/** The JSON-RPC notification method the server uses for streamed events. */
export const HERMES_RPC_EVENT_METHOD = "event";

/**
 * VERIFIED method names. `session.create`, `prompt.submit`, `session.status`,
 * `session.history`, `session.interrupt` and `llm.oneshot` were confirmed in the
 * local Hermes source. `gateway.ping` / `session.events.since` are carried as
 * names from the operator contract (not present in the locally inspected build).
 */
export const HERMES_RPC_METHODS = {
  health: "gateway.ping",
  sessionCreate: "session.create",
  promptSubmit: "prompt.submit",
  sessionStatus: "session.status",
  sessionHistory: "session.history",
  sessionInterrupt: "session.interrupt",
  sessionEventsSince: "session.events.since",
  llmOneshot: "llm.oneshot",
} as const;

export type HermesRpcMethodName = (typeof HERMES_RPC_METHODS)[keyof typeof HERMES_RPC_METHODS];

/**
 * Adapter-owned RPC protocol.
 *
 * Every field below is either a VERIFIED constant read from the Hermes source or
 * an overridable knob so a future Hermes version can be accommodated in one
 * place. No unverified param/result field is encoded: the only fields the
 * transport reads/writes are the ones proven in the source.
 */
export type HermesRpcProtocol = {
  /** VERIFIED: `/api/ws`. Overridable so a bridge can expose another route. */
  wsPath: string;
  /** VERIFIED: notifications arrive as `method:"event"`. */
  eventMethod: string;
  /** VERIFIED: `session.create` reads `params.profile`. */
  profileParam: string;
  /** VERIFIED: `prompt.submit` reads `params.session_id` and `params.text`. */
  sessionIdField: string;
  /** VERIFIED: `prompt.submit` reads `params.text`. */
  textField: string;
  /** Method name per operation. */
  methods: {
    health: string;
    sessionCreate: string;
    promptSubmit: string;
    sessionStatus: string;
    sessionHistory: string;
    sessionInterrupt: string;
    sessionEventsSince: string;
    llmOneshot: string;
  };
  /** VERIFIED event type carrying a streamed token (`params.payload.text`). */
  deltaEvent: string;
  /** VERIFIED terminal per-turn event (`params.payload.text` / `status`). */
  completeEvent: string;
  /** VERIFIED turn error event (`params.payload.message`). */
  errorEvent: string;
  /** VERIFIED server liveness event emitted right after accept. */
  readyEvent: string;
  /** Prefix for generated JSON-RPC request ids. */
  requestIdPrefix: string;
  /** Max inbound frame size in characters; larger frames are refused. */
  maxFrameBytes: number;
};

/** VERIFIED defaults, read from the local Hermes source. */
export const DEFAULT_HERMES_RPC_PROTOCOL: HermesRpcProtocol = {
  wsPath: HERMES_RPC_DEFAULT_PATH,
  eventMethod: HERMES_RPC_EVENT_METHOD,
  profileParam: "profile",
  sessionIdField: "session_id",
  textField: "text",
  methods: { ...HERMES_RPC_METHODS },
  deltaEvent: "message.delta",
  completeEvent: "message.complete",
  errorEvent: "error",
  readyEvent: "gateway.ready",
  requestIdPrefix: "nexup",
  maxFrameBytes: 2_097_152,
};

/* ═══════════════════════════════════════════════════════
   Combined protocol + resolution
   ═══════════════════════════════════════════════════════ */

export type HermesProtocolConfig = {
  /** VERIFIED primary transport (WebSocket JSON-RPC 2.0). */
  rpc: HermesRpcProtocol;
  /** PROVISIONAL — quarantined; never a default. */
  http: HermesHttpProtocol;
  /** PROVISIONAL — quarantined; never a default. */
  cli: HermesCliProtocol;
  /** VERIFIED one-shot invocation, kept as an explicit fallback/diagnostic. */
  oneshot: HermesCliOneshotProtocol;
};

/** Per-shape overrides; any omitted operation falls back to its default. */
export type HermesProtocolOverrides = {
  rpc?: Partial<HermesRpcProtocol>;
  http?: Partial<HermesHttpProtocol>;
  cli?: Partial<HermesCliProtocol>;
  oneshot?: Partial<HermesCliOneshotProtocol>;
};

export type HermesProtocolResolution = {
  protocol: HermesProtocolConfig;
  /** True when at least one default was overridden by the caller. */
  overridden: boolean;
  /** Always set: the protocol is provisional until the real contract is known. */
  notice: string;
};

/**
 * Resolves the adapter protocol, merging caller overrides over the PROVISIONAL
 * defaults. This is the single swap point for the real Hermes contract.
 */
export function resolveHermesProtocol(overrides: HermesProtocolOverrides = {}): HermesProtocolResolution {
  const rpc: HermesRpcProtocol = {
    ...DEFAULT_HERMES_RPC_PROTOCOL,
    ...overrides.rpc,
    // `methods` merges key-by-key so a partial override never drops a method.
    methods: { ...DEFAULT_HERMES_RPC_PROTOCOL.methods, ...overrides.rpc?.methods },
  };
  const http = { ...DEFAULT_HERMES_HTTP_PROTOCOL, ...overrides.http };
  const cli = { ...DEFAULT_HERMES_CLI_PROTOCOL, ...overrides.cli };
  const oneshot = { ...DEFAULT_HERMES_CLI_ONESHOT_PROTOCOL, ...overrides.oneshot };
  const overridden = Boolean(overrides.rpc || overrides.http || overrides.cli || overrides.oneshot);
  return {
    protocol: { rpc, http, cli, oneshot },
    overridden,
    notice: `${VERIFIED_HERMES_RPC_NOTICE} | ${VERIFIED_HERMES_ONESHOT_NOTICE} | ${HERMES_PROTOCOL_PROVISIONAL_NOTICE}`,
  };
}

/** Renders a relative HTTP path template, substituting already-encoded vars. */
export function renderHermesHttpPath(template: string, vars: { profile: string; id: string }): string {
  return template.replace(/\{profile\}/g, vars.profile).replace(/\{id\}/g, vars.id);
}

/** True when a protocol object is present (any non-null object shape). */
export function isHermesProtocolConfig(value: unknown): value is HermesProtocolConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "rpc" in value &&
    "http" in value &&
    "cli" in value &&
    "oneshot" in value
  );
}
