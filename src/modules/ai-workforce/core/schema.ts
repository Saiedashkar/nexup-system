/**
 * Minimal, dependency-free schema description + validator.
 *
 * Tool input/output schemas must be declarative and serialisable (they are
 * exposed by the tools API and stored in the registry), so this small DSL is
 * used instead of a validation library — none is installed in this project
 * today. Swapping in a heavier validator later only means re-implementing
 * `validateValue`; the contract around it does not change.
 */

export type FieldType = "string" | "number" | "integer" | "boolean" | "string[]";

export type FieldSchema = {
  type: FieldType;
  required?: boolean;
  description?: string;
  /** Numeric bounds (number / integer). */
  min?: number;
  max?: number;
  /** String bounds (string). */
  minLength?: number;
  maxLength?: number;
  /** Allowed values (string). */
  enum?: readonly string[];
  /** Applied when the field is absent. */
  default?: unknown;
};

export type ObjectSchema = {
  kind: "object";
  fields: Record<string, FieldSchema>;
  /** When false (default) any undeclared input key is rejected. */
  allowUnknown?: boolean;
  description?: string;
};

export type ValidationIssue = {
  path: string;
  code:
    | "expected_object"
    | "required"
    | "invalid_type"
    | "too_small"
    | "too_large"
    | "too_short"
    | "too_long"
    | "not_in_enum"
    | "unknown_field";
  message: string;
};

// A string discriminant is used instead of a boolean one because this project
// compiles with `strict: false`, where boolean-literal unions do not narrow.
export type ValidationResult =
  | { kind: "valid"; value: Record<string, unknown> }
  | { kind: "invalid"; issues: ValidationIssue[] };

const TYPE_LABEL: Record<FieldType, string> = {
  string: "نص",
  number: "رقم",
  integer: "رقم صحيح",
  boolean: "قيمة منطقية",
  "string[]": "قائمة نصوص",
};

function checkField(path: string, schema: FieldSchema, raw: unknown): { value?: unknown; issue?: ValidationIssue } {
  switch (schema.type) {
    case "string": {
      if (typeof raw !== "string") {
        return { issue: { path, code: "invalid_type", message: `Expected ${TYPE_LABEL.string}` } };
      }
      if (schema.minLength !== undefined && raw.length < schema.minLength) {
        return { issue: { path, code: "too_short", message: `Must be at least ${schema.minLength} characters` } };
      }
      if (schema.maxLength !== undefined && raw.length > schema.maxLength) {
        return { issue: { path, code: "too_long", message: `Must be at most ${schema.maxLength} characters` } };
      }
      if (schema.enum && !schema.enum.includes(raw)) {
        return { issue: { path, code: "not_in_enum", message: `Must be one of: ${schema.enum.join(", ")}` } };
      }
      return { value: raw };
    }
    case "number":
    case "integer": {
      if (typeof raw !== "number" || Number.isNaN(raw)) {
        return { issue: { path, code: "invalid_type", message: `Expected ${TYPE_LABEL[schema.type]}` } };
      }
      if (schema.type === "integer" && !Number.isInteger(raw)) {
        return { issue: { path, code: "invalid_type", message: "Expected an integer" } };
      }
      if (schema.min !== undefined && raw < schema.min) {
        return { issue: { path, code: "too_small", message: `Must be >= ${schema.min}` } };
      }
      if (schema.max !== undefined && raw > schema.max) {
        return { issue: { path, code: "too_large", message: `Must be <= ${schema.max}` } };
      }
      return { value: raw };
    }
    case "boolean": {
      if (typeof raw !== "boolean") {
        return { issue: { path, code: "invalid_type", message: `Expected ${TYPE_LABEL.boolean}` } };
      }
      return { value: raw };
    }
    case "string[]": {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
        return { issue: { path, code: "invalid_type", message: `Expected ${TYPE_LABEL["string[]"]}` } };
      }
      if (schema.min !== undefined && raw.length < schema.min) {
        return { issue: { path, code: "too_small", message: `Must contain at least ${schema.min} items` } };
      }
      if (schema.max !== undefined && raw.length > schema.max) {
        return { issue: { path, code: "too_large", message: `Must contain at most ${schema.max} items` } };
      }
      return { value: raw };
    }
    default:
      return { issue: { path, code: "invalid_type", message: "Unsupported field type" } };
  }
}

/**
 * Validates `raw` against `schema`.
 *
 * - undeclared keys are rejected unless `allowUnknown` is set
 * - declared defaults are applied for absent optional fields
 * - the returned value is a fresh object (no reference to the caller's input)
 */
export function validateValue(schema: ObjectSchema, raw: unknown): ValidationResult {
  if (raw === null || raw === undefined) {
    const issues: ValidationIssue[] = [];
    for (const [key, field] of Object.entries(schema.fields)) {
      if (field.required) issues.push({ path: key, code: "required", message: "Required field is missing" });
    }
    if (issues.length === 0) return { kind: "valid", value: {} };
    return { kind: "invalid", issues };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "invalid", issues: [{ path: "", code: "expected_object", message: "Expected an object" }] };
  }

  const source = raw as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const value: Record<string, unknown> = {};

  if (!schema.allowUnknown) {
    for (const key of Object.keys(source)) {
      if (!(key in schema.fields)) {
        issues.push({ path: key, code: "unknown_field", message: "Unknown field" });
      }
    }
  }

  for (const [key, field] of Object.entries(schema.fields)) {
    const present = Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined;

    if (!present) {
      if (field.required) {
        issues.push({ path: key, code: "required", message: "Required field is missing" });
      } else if (field.default !== undefined) {
        value[key] = field.default;
      }
      continue;
    }

    const checked = checkField(key, field, source[key]);
    if (checked.issue) issues.push(checked.issue);
    else value[key] = checked.value;
  }

  return issues.length > 0 ? { kind: "invalid", issues } : { kind: "valid", value };
}

/** Convenience helper for building a field. */
export function field(type: FieldType, extra: Omit<FieldSchema, "type"> = {}): FieldSchema {
  return { type, ...extra };
}
