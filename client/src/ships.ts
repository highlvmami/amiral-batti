import { shipLength, type Placement, type ShipType } from "../../shared/rules.js";

export type ShipState = "normal" | "sunk" | "preview" | "bad";

const NS = "http://www.w3.org/2000/svg";

/** Hull outline pointing right: squared stern on the left, pointed bow on the right. */
function hull(w: number, beam = 30): string {
  const t = 50 - beam;
  const b = 50 + beam;
  return `M14 ${t + 8} L${w - 52} ${t} C${w - 22} ${t + 6} ${w - 6} 42 ${w - 6} 50 C${w - 6} 58 ${w - 22} ${b - 6} ${w - 52} ${b} L14 ${b - 8} Q4 50 14 ${t + 8}Z`;
}

function deck(w: number, beam = 30): string {
  const t = 50 - beam + 8;
  const b = 50 + beam - 8;
  return `M22 ${t + 6} L${w - 54} ${t} C${w - 30} ${t + 4} ${w - 18} 45 ${w - 18} 50 C${w - 18} 55 ${w - 30} ${b - 4} ${w - 54} ${b} L22 ${b - 6} Q16 50 22 ${t + 6}Z`;
}

function turret(x: number, y = 50, r = 11): string {
  return `<circle class="s" cx="${x}" cy="${y}" r="${r}"/><rect class="s" x="${x}" y="${y - 2.5}" width="${r + 16}" height="2.2"/><rect class="s" x="${x}" y="${y + 0.5}" width="${r + 16}" height="2.2"/>`;
}

function plane(x: number, y: number): string {
  return `<g class="w"><rect x="${x}" y="${y - 2}" width="22" height="4" rx="2"/><rect x="${x + 7}" y="${y - 11}" width="6" height="22" rx="2"/><rect x="${x}" y="${y - 5}" width="4" height="10" rx="1"/></g>`;
}

const BODY: Record<ShipType, (w: number) => string> = {
  carrier: (w) => `
    <path class="foam" d="${hull(w, 36)}"/>
    <path class="h" d="${hull(w, 36)}"/>
    <path class="d" d="${deck(w, 36)}"/>
    <line class="m" x1="40" y1="56" x2="${w - 70}" y2="56" stroke-dasharray="14 10"/>
    <rect class="s" x="${w * 0.55}" y="22" width="64" height="15" rx="4"/>
    <rect class="w" x="${w * 0.55 + 38}" y="25" width="10" height="9" rx="1"/>
    ${plane(60, 66)}${plane(125, 66)}${plane(w - 190, 66)}
    <circle class="m" cx="${w - 78}" cy="56" r="7"/>`,
  battleship: (w) => `
    <path class="foam" d="${hull(w, 30)}"/>
    <path class="h" d="${hull(w, 30)}"/>
    <path class="d" d="${deck(w, 30)}"/>
    ${turret(w * 0.2)}${turret(w * 0.34)}${turret(w * 0.74)}
    <rect class="s" x="${w * 0.5 - 22}" y="38" width="44" height="24" rx="6"/>
    <rect class="w" x="${w * 0.5 - 10}" y="44" width="20" height="12" rx="2"/>
    <circle class="s" cx="${w * 0.6}" cy="50" r="8"/>`,
  submarine: (w) => `
    <ellipse class="foam" cx="${w / 2}" cy="50" rx="${w / 2 - 6}" ry="22"/>
    <ellipse class="h" cx="${w / 2}" cy="50" rx="${w / 2 - 10}" ry="19"/>
    <ellipse class="d" cx="${w / 2}" cy="50" rx="${w / 2 - 22}" ry="11"/>
    <rect class="s" x="${w * 0.48 - 20}" y="40" width="40" height="20" rx="9"/>
    <line class="m" x1="${w * 0.48 + 6}" y1="50" x2="${w * 0.48 + 6}" y2="38"/>
    <path class="s" d="M18 50 l-12 -9 v18z"/>`,
  patrol: (w) => `
    <path class="foam" d="${hull(w, 26)}"/>
    <path class="h" d="${hull(w, 26)}"/>
    <path class="d" d="${deck(w, 26)}"/>
    <rect class="s" x="${w * 0.36}" y="38" width="40" height="24" rx="5"/>
    <rect class="w" x="${w * 0.36 + 24}" y="42" width="10" height="16" rx="2"/>
    <circle class="s" cx="${w * 0.74}" cy="50" r="7"/><rect class="s" x="${w * 0.74}" y="48.8" width="16" height="2.4"/>
    <line class="m" x1="${w * 0.36 + 10}" y1="50" x2="${w * 0.36 + 10}" y2="36"/>`,
};

/** A positioned SVG ship that exactly covers its cells on a 10x10 board. */
export function shipElement(p: Placement, state: ShipState = "normal"): HTMLElement {
  const len = shipLength(p.type);
  const w = len * 100;
  const vertical = p.dir === "v";
  const el = document.createElement("div");
  el.className = `ship-svg ${state === "normal" ? "" : state} ${p.type}`.trim();
  el.style.left = `${p.x * 10}%`;
  el.style.top = `${p.y * 10}%`;
  el.style.width = `${(vertical ? 1 : len) * 10}%`;
  el.style.height = `${(vertical ? len : 1) * 10}%`;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", vertical ? `0 0 100 ${w}` : `0 0 ${w} 100`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.innerHTML = vertical
    ? `<g transform="translate(100 0) rotate(90)">${BODY[p.type](w)}</g>`
    : BODY[p.type](w);
  el.append(svg);
  return el;
}
