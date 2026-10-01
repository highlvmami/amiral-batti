/** International maritime signal flags (A–Z), drawn as simple SVG shapes in a 100x100 box. */

const C = { r: "#D6453D", b: "#1F5FA8", y: "#F2B632", k: "#1E2A33", w: "#FFFFFF" };

const rect = (x: number, y: number, w: number, h: number, c: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const poly = (pts: string, c: string) => `<polygon points="${pts}" fill="${c}"/>`;
const hStripes = (cs: string[]) => cs.map((c, i) => rect(0, (i * 100) / cs.length, 100, 100 / cs.length + 0.5, c)).join("");
const vStripes = (cs: string[]) => cs.map((c, i) => rect((i * 100) / cs.length, 0, 100 / cs.length + 0.5, 100, c)).join("");
const lines = (d: string, c: string, w: number) => `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none"/>`;
const SALTIRE = "M0 0L100 100M100 0L0 100";

function checker(): string {
  let out = rect(0, 0, 100, 100, C.w);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) out += rect(x * 25, y * 25, 25, 25, C.b);
  return out;
}

const FLAGS: Record<string, string> = {
  A: rect(0, 0, 50, 100, C.w) + rect(50, 0, 50, 100, C.b),
  B: rect(0, 0, 100, 100, C.r),
  C: hStripes([C.b, C.w, C.r, C.w, C.b]),
  D: hStripes([C.y, C.b, C.y]),
  E: hStripes([C.b, C.r]),
  F: rect(0, 0, 100, 100, C.w) + poly("50,12 88,50 50,88 12,50", C.r),
  G: vStripes([C.y, C.b, C.y, C.b, C.y, C.b]),
  H: rect(0, 0, 50, 100, C.w) + rect(50, 0, 50, 100, C.r),
  I: rect(0, 0, 100, 100, C.y) + `<circle cx="50" cy="50" r="22" fill="${C.k}"/>`,
  J: hStripes([C.b, C.w, C.b]),
  K: rect(0, 0, 50, 100, C.y) + rect(50, 0, 50, 100, C.b),
  L: rect(0, 0, 50, 50, C.y) + rect(50, 0, 50, 50, C.k) + rect(0, 50, 50, 50, C.k) + rect(50, 50, 50, 50, C.y),
  M: rect(0, 0, 100, 100, C.b) + lines(SALTIRE, C.w, 24),
  N: checker(),
  O: rect(0, 0, 100, 100, C.r) + poly("0,0 100,0 0,100", C.y),
  P: rect(0, 0, 100, 100, C.b) + rect(25, 25, 50, 50, C.w),
  Q: rect(0, 0, 100, 100, C.y),
  R: rect(0, 0, 100, 100, C.r) + rect(40, 0, 20, 100, C.y) + rect(0, 40, 100, 20, C.y),
  S: rect(0, 0, 100, 100, C.w) + rect(25, 25, 50, 50, C.b),
  T: vStripes([C.r, C.w, C.b]),
  U: rect(0, 0, 50, 50, C.r) + rect(50, 0, 50, 50, C.w) + rect(0, 50, 50, 50, C.w) + rect(50, 50, 50, 50, C.r),
  V: rect(0, 0, 100, 100, C.w) + lines(SALTIRE, C.r, 24),
  W: rect(0, 0, 100, 100, C.b) + rect(17, 17, 66, 66, C.w) + rect(34, 34, 32, 32, C.r),
  X: rect(0, 0, 100, 100, C.w) + rect(40, 0, 20, 100, C.b) + rect(0, 40, 100, 20, C.b),
  Y: rect(0, 0, 100, 100, C.y) + lines("M-10 30L30 -10M-10 70L70 -10M-10 110L110 -10M30 110L110 30M70 110L110 70", C.r, 20),
  Z: poly("0,0 100,0 50,50", C.y) + poly("100,0 100,100 50,50", C.b) + poly("0,100 100,100 50,50", C.r) + poly("0,0 0,100 50,50", C.k),
};

/** Flags with a swallowtail cut, as on the real A and B pennants. */
const SWALLOWTAIL = new Set(["A", "B"]);

const TURKISH: Record<string, string> = { Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" };

/** Maps a name to flag letters: Turkish letters fall back to their base letter, other characters are skipped. */
export function flagLetters(name: string, max = 12): string[] {
  const letters: string[] = [];
  for (const ch of name.toLocaleUpperCase("tr")) {
    const letter = TURKISH[ch] ?? ch;
    if (letter in FLAGS) letters.push(letter);
    if (letters.length === max) break;
  }
  return letters;
}

export function flagElement(letter: string): HTMLElement {
  const el = document.createElement("span");
  el.className = SWALLOWTAIL.has(letter) ? "flag swallow" : "flag";
  el.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${FLAGS[letter]}</svg>`;
  el.title = letter;
  return el;
}
