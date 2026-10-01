import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomView, ServerMessage } from "../shared/protocol.js";
import { shipCells, type Placement } from "../shared/rules.js";
import { Room, type Player } from "../server/room.js";

const fleet: Placement[] = [
  { type: "carrier", x: 0, y: 0, dir: "h" },
  { type: "battleship", x: 0, y: 2, dir: "h" },
  { type: "submarine", x: 0, y: 4, dir: "h" },
  { type: "patrol", x: 0, y: 6, dir: "h" },
];

function player(name: string) {
  const inbox: ServerMessage[] = [];
  const p: Player = { id: name, token: name, name, send: (m) => inbox.push(m), room: null };
  const last = (): RoomView => {
    const states = inbox.filter((m) => m.type === "room:state");
    return (states.at(-1) as Extract<ServerMessage, { type: "room:state" }>).room;
  };
  return { p, last };
}

function setup() {
  const room = new Room("ABCDEF", () => {}, 1000);
  const a = player("Ali");
  const b = player("Ayşe");
  room.join(a.p);
  room.join(b.p);
  room.placeFleet(a.p, fleet);
  room.placeFleet(b.p, fleet);
  return { room, a, b };
}

/** The shooter sinks the whole fleet; the other player misses in between. */
function playOut(room: Room, shooter: Player, other: Player) {
  let miss = 0;
  for (const p of fleet) {
    for (const [x, y] of shipCells(p)) {
      if (room.phase !== "playing") return;
      if (room.viewFor(shooter).turn !== "you") room.fire(other, 9, miss++);
      room.fire(shooter, x, y);
    }
  }
}

afterEach(() => vi.useRealTimers());

describe("Room", () => {
  it("starts placing when two players join and playing when both are ready", () => {
    const { a, b } = setup();
    expect(a.last().phase).toBe("playing");
    expect(a.last().turn).toBe("you");
    expect(b.last().turn).toBe("opponent");
  });

  it("never reveals the opponent fleet during play", () => {
    const { a } = setup();
    expect(a.last().enemyFleet).toBeNull();
    expect(a.last().enemySunk).toEqual([]);
  });

  it("enforces turns and duplicate shots", () => {
    const { room, a, b } = setup();
    expect(room.fire(b.p, 0, 0)).toMatch(/Sıra/);
    expect(room.fire(a.p, 9, 9)).toBeNull();
    expect(room.fire(a.p, 9, 8)).toMatch(/Sıra/);
    room.fire(b.p, 9, 9);
    expect(room.fire(a.p, 9, 9)).toMatch(/zaten/);
  });

  it("scores a win, reveals the fleet and supports a rematch", () => {
    const { room, a, b } = setup();
    playOut(room, a.p, b.p);
    expect(a.last().phase).toBe("finished");
    expect(a.last().winner).toBe("you");
    expect(b.last().winner).toBe("opponent");
    expect(b.last().enemyFleet).toHaveLength(4);
    expect(a.last().you.score).toBe(1);

    room.requestRematch(a.p);
    expect(b.last().opponent?.wantsRematch).toBe(true);
    expect(b.last().phase).toBe("finished");
    room.requestRematch(b.p);
    expect(a.last().phase).toBe("placing");
    expect(a.last().round).toBe(2);
    expect(a.last().you.score).toBe(1);

    room.placeFleet(a.p, fleet);
    room.placeFleet(b.p, fleet);
    // The other player fires first in the second round.
    expect(b.last().turn).toBe("you");
  });

  it("shares chat with sender perspective", () => {
    const { room, a, b } = setup();
    room.chatSend(a.p, "Merhaba!");
    expect(a.last().chat.at(-1)).toMatchObject({ from: "you", text: "Merhaba!" });
    expect(b.last().chat.at(-1)).toMatchObject({ from: "opponent", name: "Ali" });
  });

  it("forfeits a player who stays disconnected during play", () => {
    vi.useFakeTimers();
    const { room, a, b } = setup();
    a.p.send = null;
    room.disconnected(a.p);
    expect(b.last().opponent?.connected).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(b.last().chat.map((c) => c.text)).toContain("Ayşe kazandı!");
    expect(b.last().phase).toBe("waiting");
    expect(b.last().opponent).toBeNull();
  });

  it("lets a player reconnect before the timeout", () => {
    vi.useFakeTimers();
    const { room, a, b } = setup();
    const send = a.p.send;
    a.p.send = null;
    room.disconnected(a.p);
    a.p.send = send;
    room.reconnected(a.p);
    vi.advanceTimersByTime(5000);
    expect(b.last().phase).toBe("playing");
    expect(b.last().opponent?.connected).toBe(true);
  });
});
