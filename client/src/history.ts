import type { RoomView } from "../../shared/protocol.js";

/** One finished round, as remembered by this browser. */
export interface MatchRecord {
  /** Room code + round, so a re-sent "finished" state is never stored twice. */
  id: string;
  opponent: string;
  won: boolean;
  /** Room score right after this round: [you, opponent]. */
  score: [number, number];
  shots: number;
  ts: number;
}

export const HISTORY_KEY = "ab-history";
export const HISTORY_LIMIT = 10;

type Store = Pick<Storage, "getItem" | "setItem">;

function isRecord(r: unknown): r is MatchRecord {
  const m = r as MatchRecord;
  return (
    !!m &&
    typeof m.id === "string" &&
    typeof m.opponent === "string" &&
    typeof m.won === "boolean" &&
    Array.isArray(m.score) &&
    typeof m.shots === "number" &&
    typeof m.ts === "number"
  );
}

export function loadHistory(store: Store): MatchRecord[] {
  try {
    const list: unknown = JSON.parse(store.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter(isRecord).slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Turns a finished room into a history entry; null while the round is still going. */
export function recordFromRoom(v: RoomView, now = Date.now()): MatchRecord | null {
  if (v.phase !== "finished" || !v.winner) return null;
  return {
    id: `${v.code}-${v.round}`,
    opponent: v.opponent?.name ?? "Rakip",
    won: v.winner === "you",
    score: [v.you.score, v.opponent?.score ?? 0],
    shots: v.myShots.length,
    ts: now,
  };
}

/** Puts the record first, keeps the newest HISTORY_LIMIT. Returns false when it was already stored. */
export function saveRecord(store: Store, record: MatchRecord): boolean {
  const list = loadHistory(store);
  if (list.some((r) => r.id === record.id)) return false;
  try {
    store.setItem(HISTORY_KEY, JSON.stringify([record, ...list].slice(0, HISTORY_LIMIT)));
    return true;
  } catch {
    return false;
  }
}

/** "Bugün 14:05", "Dün 21:30" or "28 Eyl 18:12". */
export function formatWhen(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const day = (t: number) => new Date(t).toDateString();
  if (day(ts) === day(now)) return `Bugün ${time}`;
  if (day(ts) === day(now - 86_400_000)) return `Dün ${time}`;
  return `${d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} ${time}`;
}
