import { describe, expect, it } from "vitest";
import type { RoomView } from "../shared/protocol.js";
import {
  HISTORY_KEY,
  HISTORY_LIMIT,
  formatWhen,
  loadHistory,
  recordFromRoom,
  saveRecord,
  type MatchRecord,
} from "../client/src/history.js";

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const player = (name: string, score: number) => ({ name, connected: true, ready: true, wantsRematch: false, score });

function room(over: Partial<RoomView> = {}): RoomView {
  return {
    code: "ABC123",
    phase: "finished",
    round: 2,
    you: player("Barbaros", 2),
    opponent: player("Turgut", 0),
    turn: null,
    winner: "you",
    myFleet: null,
    shotsAtMe: [],
    myShots: [
      { x: 0, y: 0, outcome: "miss" },
      { x: 1, y: 0, outcome: "hit" },
    ],
    enemySunk: [],
    enemyFleet: null,
    chat: [],
    ...over,
  };
}

const rec = (id: string, ts = 0): MatchRecord => ({ id, opponent: "X", won: true, score: [1, 0], shots: 20, ts });

describe("recordFromRoom", () => {
  it("captures opponent, result, score and shot count", () => {
    expect(recordFromRoom(room(), 1000)).toEqual({
      id: "ABC123-2",
      opponent: "Turgut",
      won: true,
      score: [2, 0],
      shots: 2,
      ts: 1000,
    });
  });

  it("records a loss", () => {
    expect(recordFromRoom(room({ winner: "opponent" }))?.won).toBe(false);
  });

  it("ignores rounds that are not finished", () => {
    expect(recordFromRoom(room({ phase: "playing", winner: null }))).toBeNull();
  });
});

describe("saveRecord / loadHistory", () => {
  it("starts empty and survives garbage in storage", () => {
    expect(loadHistory(memoryStore())).toEqual([]);
    expect(loadHistory(memoryStore({ [HISTORY_KEY]: "{bozuk" }))).toEqual([]);
    expect(loadHistory(memoryStore({ [HISTORY_KEY]: '[{"id":1}]' }))).toEqual([]);
  });

  it("puts the newest match first and skips duplicates of the same round", () => {
    const s = memoryStore();
    expect(saveRecord(s, rec("A-1"))).toBe(true);
    expect(saveRecord(s, rec("A-2"))).toBe(true);
    expect(saveRecord(s, rec("A-2"))).toBe(false);
    expect(loadHistory(s).map((r) => r.id)).toEqual(["A-2", "A-1"]);
  });

  it(`keeps only the last ${HISTORY_LIMIT} matches`, () => {
    const s = memoryStore();
    for (let i = 1; i <= HISTORY_LIMIT + 3; i++) saveRecord(s, rec(`R-${i}`));
    const ids = loadHistory(s).map((r) => r.id);
    expect(ids).toHaveLength(HISTORY_LIMIT);
    expect(ids[0]).toBe(`R-${HISTORY_LIMIT + 3}`);
  });
});

describe("formatWhen", () => {
  const now = new Date(2026, 9, 1, 15, 0).getTime();
  it("says today / yesterday / the date", () => {
    expect(formatWhen(new Date(2026, 9, 1, 9, 5).getTime(), now)).toMatch(/^Bugün 09[:.]05$/);
    expect(formatWhen(new Date(2026, 8, 30, 21, 30).getTime(), now)).toMatch(/^Dün 21[:.]30$/);
    expect(formatWhen(new Date(2026, 8, 28, 18, 12).getTime(), now)).toMatch(/^28 Eyl 18[:.]12$/);
  });
});
