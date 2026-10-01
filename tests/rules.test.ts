import { describe, expect, it } from "vitest";
import { Board, FLEET, randomFleet, shipCells, validateFleet, type Placement } from "../shared/rules.js";

const fleet: Placement[] = [
  { type: "carrier", x: 0, y: 0, dir: "h" },
  { type: "battleship", x: 0, y: 2, dir: "v" },
  { type: "submarine", x: 5, y: 5, dir: "h" },
  { type: "patrol", x: 9, y: 8, dir: "v" },
];

describe("validateFleet", () => {
  it("accepts a valid fleet", () => {
    expect(validateFleet(fleet)).toBeNull();
  });

  it("rejects overlapping ships", () => {
    expect(validateFleet([...fleet.slice(0, 3), { type: "patrol", x: 0, y: 0, dir: "v" }])).toMatch(/üst üste/);
  });

  it("rejects ships off the board", () => {
    expect(validateFleet([...fleet.slice(0, 3), { type: "patrol", x: 9, y: 9, dir: "v" }])).toMatch(/dışına/);
  });

  it("rejects missing or duplicate ships", () => {
    expect(validateFleet(fleet.slice(0, 3))).not.toBeNull();
    expect(validateFleet([...fleet.slice(0, 3), { type: "carrier", x: 0, y: 9, dir: "h" }])).not.toBeNull();
  });
});

describe("randomFleet", () => {
  it("always produces a valid fleet", () => {
    for (let i = 0; i < 200; i++) expect(validateFleet(randomFleet())).toBeNull();
  });
});

describe("Board", () => {
  it("reports miss, hit, sunk and fleet destroyed", () => {
    const board = new Board(fleet);
    expect(board.receive(9, 0).outcome).toBe("miss");
    expect(board.receive(9, 8).outcome).toBe("hit");
    const sunk = board.receive(9, 9);
    expect(sunk.outcome).toBe("sunk");
    expect(sunk.sunk?.type).toBe("patrol");
    expect(sunk.fleetDestroyed).toBe(false);

    let last = sunk;
    for (const p of fleet.slice(0, 3)) for (const [x, y] of shipCells(p)) last = board.receive(x, y);
    expect(last.fleetDestroyed).toBe(true);
  });

  it("has four ship types", () => {
    expect(FLEET.map((s) => s.length)).toEqual([5, 4, 3, 2]);
  });
});
