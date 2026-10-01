export const BOARD_SIZE = 10;

export type ShipType = "carrier" | "battleship" | "submarine" | "patrol";
export type Orientation = "h" | "v";

export interface ShipSpec {
  type: ShipType;
  name: string;
  length: number;
}

export const FLEET: readonly ShipSpec[] = [
  { type: "carrier", name: "Uçak Gemisi", length: 5 },
  { type: "battleship", name: "Muhrip", length: 4 },
  { type: "submarine", name: "Denizaltı", length: 3 },
  { type: "patrol", name: "Hücumbot", length: 2 },
];

export interface Placement {
  type: ShipType;
  x: number;
  y: number;
  dir: Orientation;
}

export type Cell = [x: number, y: number];

export function shipLength(type: ShipType): number {
  const spec = FLEET.find((s) => s.type === type);
  if (!spec) throw new Error(`Bilinmeyen gemi: ${type}`);
  return spec.length;
}

export function shipCells(p: Placement): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < shipLength(p.type); i++) {
    cells.push(p.dir === "h" ? [p.x + i, p.y] : [p.x, p.y + i]);
  }
  return cells;
}

const inBounds = ([x, y]: Cell) =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;

/** Returns an error message, or null when the fleet is valid. */
export function validateFleet(fleet: Placement[]): string | null {
  if (fleet.length !== FLEET.length) return "Filoda her gemiden bir tane olmalı.";
  const types = new Set(fleet.map((p) => p.type));
  if (types.size !== FLEET.length || FLEET.some((s) => !types.has(s.type))) {
    return "Filoda her gemiden bir tane olmalı.";
  }
  const occupied = new Set<string>();
  for (const p of fleet) {
    for (const c of shipCells(p)) {
      if (!inBounds(c)) return "Gemi tahtanın dışına taşıyor.";
      const key = `${c[0]},${c[1]}`;
      if (occupied.has(key)) return "Gemiler üst üste gelemez.";
      occupied.add(key);
    }
  }
  return null;
}

export function randomFleet(rand: () => number = Math.random): Placement[] {
  for (;;) {
    const fleet: Placement[] = [];
    let ok = true;
    for (const spec of FLEET) {
      let placed = false;
      for (let attempt = 0; attempt < 200 && !placed; attempt++) {
        const dir: Orientation = rand() < 0.5 ? "h" : "v";
        const max = BOARD_SIZE - spec.length;
        const p: Placement = {
          type: spec.type,
          dir,
          x: Math.floor(rand() * (dir === "h" ? max + 1 : BOARD_SIZE)),
          y: Math.floor(rand() * (dir === "v" ? max + 1 : BOARD_SIZE)),
        };
        if (validatePartial([...fleet, p])) {
          fleet.push(p);
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return fleet;
  }
}

/** True when ships are in bounds and do not overlap (fleet may be incomplete). */
export function validatePartial(fleet: Placement[]): boolean {
  const occupied = new Set<string>();
  for (const p of fleet) {
    for (const c of shipCells(p)) {
      if (!inBounds(c)) return false;
      const key = `${c[0]},${c[1]}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
    }
  }
  return true;
}

export type ShotOutcome = "miss" | "hit" | "sunk";

export interface ShotResult {
  outcome: ShotOutcome;
  sunk?: Placement;
  fleetDestroyed: boolean;
}

/** Board state for one player: their ships and the shots received. */
export class Board {
  readonly fleet: Placement[];
  readonly shots = new Set<string>();

  constructor(fleet: Placement[]) {
    this.fleet = fleet;
  }

  hasShot(x: number, y: number): boolean {
    return this.shots.has(`${x},${y}`);
  }

  receive(x: number, y: number): ShotResult {
    this.shots.add(`${x},${y}`);
    const ship = this.fleet.find((p) => shipCells(p).some(([cx, cy]) => cx === x && cy === y));
    if (!ship) return { outcome: "miss", fleetDestroyed: false };
    const sunk = shipCells(ship).every(([cx, cy]) => this.hasShot(cx, cy));
    return {
      outcome: sunk ? "sunk" : "hit",
      sunk: sunk ? ship : undefined,
      fleetDestroyed: this.fleet.every((p) => shipCells(p).every(([cx, cy]) => this.hasShot(cx, cy))),
    };
  }
}
