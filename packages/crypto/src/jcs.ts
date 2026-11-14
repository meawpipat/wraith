import { ProgrammerError } from "./errors.js";
import { utf8Encode } from "./utf8.js";

type ArrayFrame = { kind: "array"; source: object; items: unknown[]; next: number };
type ObjectFrame = {
  kind: "object";
  source: object;
  entries: [string, unknown][];
  next: number;
};
type Frame = ArrayFrame | ObjectFrame;

function shortEscape(c: number): string | undefined {
  switch (c) {
    case 0x08:
      return "\\b";
    case 0x09:
      return "\\t";
    case 0x0a:
      return "\\n";
    case 0x0c:
      return "\\f";
    case 0x0d:
      return "\\r";
    case 0x22:
      return '\\"';
    case 0x5c:
      return "\\\\";
    default:
      return undefined;
  }
}

const HEX = "0123456789abcdef";

/** Quotes a string per RFC 8785 section 3.2.2.2 in one pass; rejects lone surrogates. */
function quote(text: string): string {
  let out = '"';
  let runStart = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      throw new ProgrammerError("lone_surrogate");
    }
    if (c >= 0xdc00 && c <= 0xdfff) throw new ProgrammerError("lone_surrogate");
    if (c < 0x20 || c === 0x22 || c === 0x5c) {
      out += text.slice(runStart, i);
      out += shortEscape(c) ?? `\\u00${HEX[c >> 4]}${HEX[c & 15]}`;
      runStart = i + 1;
    }
  }
  return `${out}${text.slice(runStart)}"`;
}

function dataValue(descriptor: PropertyDescriptor | undefined): unknown {
  if (descriptor === undefined) throw new ProgrammerError("non_json_value");
  if (!("value" in descriptor) || descriptor.enumerable !== true) {
    throw new ProgrammerError("non_json_value");
  }
  return descriptor.value;
}

function arrayFrame(value: unknown[]): ArrayFrame {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new ProgrammerError("non_json_value");
  }
  const length = value.length;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) throw new ProgrammerError("non_json_value");
  const items: unknown[] = [];
  for (let i = 0; i < length; i++) {
    items.push(dataValue(Reflect.getOwnPropertyDescriptor(value, String(i))));
  }
  return { kind: "array", source: value, items, next: 0 };
}

function objectFrame(value: object): ObjectFrame {
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new ProgrammerError("non_json_value");
  }
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new ProgrammerError("non_json_value");
    entries.push([key, dataValue(Reflect.getOwnPropertyDescriptor(value, key))]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { kind: "object", source: value, entries, next: 0 };
}

/** RFC 8785 canonical JSON text of a JSON value. Throws ProgrammerError otherwise. */
export function canonicalize(value: unknown): string {
  const parts: string[] = [];
  const stack: Frame[] = [];
  const path = new Set<object>();

  const emit = (v: unknown): void => {
    switch (typeof v) {
      case "string":
        parts.push(quote(v));
        return;
      case "number":
        if (!Number.isFinite(v)) throw new ProgrammerError("non_finite_number");
        parts.push(Object.is(v, -0) ? "0" : String(v));
        return;
      case "boolean":
        parts.push(v ? "true" : "false");
        return;
      case "bigint":
        throw new ProgrammerError("bigint_value");
      case "object": {
        if (v === null) {
          parts.push("null");
          return;
        }
        if (path.has(v)) throw new ProgrammerError("cyclic_value");
        const isArray = Array.isArray(v);
        const frame = isArray ? arrayFrame(v) : objectFrame(v);
        path.add(v);
        stack.push(frame);
        parts.push(isArray ? "[" : "{");
        return;
      }
      default:
        throw new ProgrammerError("non_json_value");
    }
  };

  emit(value);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as Frame;
    const size = frame.kind === "array" ? frame.items.length : frame.entries.length;
    if (frame.next >= size) {
      parts.push(frame.kind === "array" ? "]" : "}");
      path.delete(frame.source);
      stack.pop();
      continue;
    }
    if (frame.next > 0) parts.push(",");
    if (frame.kind === "array") {
      emit(frame.items[frame.next++]);
    } else {
      const [key, child] = frame.entries[frame.next++] as [string, unknown];
      parts.push(quote(key), ":");
      emit(child);
    }
  }
  return parts.join("");
}

/** UTF-8 bytes of the canonical JSON text. */
export function canonicalizeBytes(value: unknown): Uint8Array {
  return utf8Encode(canonicalize(value));
}
