import { afterEach, describe, expect, it, vi } from "vitest";
import { Invites, lobbyList } from "../server/lobby.js";
import { Room, type Player } from "../server/room.js";

const make = (name: string): Player => ({ id: name, token: `t-${name}`, name, send: () => {}, room: null });

afterEach(() => vi.useRealTimers());

describe("lobbyList", () => {
  it("lists other connected players, free ones first, and marks players in a room busy", () => {
    const [ali, ayse, can, zeynep] = ["Ali", "Ayşe", "Can", "Zeynep"].map(make);
    can.send = null; // offline
    const room = new Room("ABCDEF", () => {});
    room.join(ayse);
    expect(lobbyList([ali, ayse, can, zeynep], ali)).toEqual([
      { id: "Zeynep", name: "Zeynep", busy: false },
      { id: "Ayşe", name: "Ayşe", busy: true },
    ]);
  });
});

describe("Invites", () => {
  it("tracks, takes and drops invites", () => {
    const expired = vi.fn();
    const invites = new Invites(expired);
    const [a, b, c] = ["a", "b", "c"].map(make);
    invites.add(a, b);
    invites.add(c, a);
    expect(invites.has(a, b)).toBe(true);
    expect(invites.has(b, a)).toBe(false);
    expect(invites.take(a, b)).toEqual({ from: a, to: b });
    expect(invites.take(a, b)).toBeUndefined();
    expect(invites.dropFor(a)).toHaveLength(1);
    expect(invites.has(c, a)).toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it("expires an invite after the ttl", () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const invites = new Invites(expired, 1000);
    const [a, b] = ["a", "b"].map(make);
    invites.add(a, b);
    vi.advanceTimersByTime(999);
    expect(expired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expired).toHaveBeenCalledWith({ from: a, to: b });
    expect(invites.has(a, b)).toBe(false);
  });
});
