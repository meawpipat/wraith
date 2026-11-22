/** Pure replay comparison for Q23: the ids of `agent_message_chunk` and `tool_call` updates. */

export interface ReplayIds {
  /** `agent_message_chunk:<messageId>` and `tool_call:<toolCallId>`, in arrival order. */
  ids: string[];
  /** Updates of those two kinds that carried no id at all. */
  withoutId: number;
}

export interface ReplayComparison {
  equal: boolean;
  /** At least one id was seen on both sides, so the comparison means something. */
  comparable: boolean;
  a: ReplayIds;
  b: ReplayIds;
  onlyInA: string[];
  onlyInB: string[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Accepts a raw update, a `session/update` notification, or a recorded ACP frame. */
export function updateOf(item: unknown): Record<string, unknown> | null {
  if (!isObject(item)) return null;
  if (typeof item.sessionUpdate === "string") return item;
  const msg = isObject(item.msg) ? item.msg : item;
  const params = isObject(msg.params) ? msg.params : null;
  const update = params !== null && isObject(params.update) ? params.update : null;
  return update !== null && typeof update.sessionUpdate === "string" ? update : null;
}

export function replayIds(items: readonly unknown[]): ReplayIds {
  const ids: string[] = [];
  let withoutId = 0;
  for (const item of items) {
    const u = updateOf(item);
    if (u === null) continue;
    const kind = u.sessionUpdate;
    if (kind !== "agent_message_chunk" && kind !== "tool_call") continue;
    const id = kind === "tool_call" ? u.toolCallId : u.messageId;
    if (typeof id === "string" && id !== "") ids.push(`${kind}:${id}`);
    else withoutId++;
  }
  return { ids, withoutId };
}

export function compareReplays(a: readonly unknown[], b: readonly unknown[]): ReplayComparison {
  const ra = replayIds(a);
  const rb = replayIds(b);
  const setA = new Set(ra.ids);
  const setB = new Set(rb.ids);
  const equal =
    ra.ids.length === rb.ids.length &&
    ra.withoutId === rb.withoutId &&
    ra.ids.every((id, i) => id === rb.ids[i]);
  return {
    equal,
    comparable: ra.ids.length > 0 && rb.ids.length > 0,
    a: ra,
    b: rb,
    onlyInA: ra.ids.filter((id) => !setB.has(id)),
    onlyInB: rb.ids.filter((id) => !setA.has(id)),
  };
}
