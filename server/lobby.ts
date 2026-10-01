import type { LobbyPlayer } from "../shared/protocol.js";
import type { Player } from "./room.js";

export const INVITE_MS = 30_000;

export interface Invite {
  from: Player;
  to: Player;
}

interface Entry extends Invite {
  timer: ReturnType<typeof setTimeout>;
}

const keyOf = (from: Player, to: Player) => `${from.id}>${to.id}`;

/** Online players visible to `self`: connected, not self. Players inside a room show as busy. */
export function lobbyList(all: Iterable<Player>, self: Player): LobbyPlayer[] {
  const list: LobbyPlayer[] = [];
  for (const p of all) {
    if (p === self || !p.send) continue;
    list.push({ id: p.id, name: p.name, busy: p.room !== null });
  }
  return list.sort((a, b) => Number(a.busy) - Number(b.busy) || a.name.localeCompare(b.name, "tr"));
}

/** Pending match invites between players, each expiring after `ttl` ms. */
export class Invites {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly onExpire: (invite: Invite) => void,
    private readonly ttl = INVITE_MS,
  ) {}

  has(from: Player, to: Player): boolean {
    return this.entries.has(keyOf(from, to));
  }

  add(from: Player, to: Player): void {
    const key = keyOf(from, to);
    const timer = setTimeout(() => {
      this.entries.delete(key);
      this.onExpire({ from, to });
    }, this.ttl);
    this.entries.set(key, { from, to, timer });
  }

  /** Removes and returns the invite, or undefined when there is none. */
  take(from: Player, to: Player): Invite | undefined {
    const key = keyOf(from, to);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.entries.delete(key);
    return { from, to };
  }

  /** Removes every invite sent by or addressed to `player` and returns them. */
  dropFor(player: Player): Invite[] {
    const dropped: Invite[] = [];
    for (const [key, entry] of this.entries) {
      if (entry.from !== player && entry.to !== player) continue;
      clearTimeout(entry.timer);
      this.entries.delete(key);
      dropped.push({ from: entry.from, to: entry.to });
    }
    return dropped;
  }
}
