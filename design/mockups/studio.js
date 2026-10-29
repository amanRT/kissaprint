// Deterministic generators for the mockup studio (so re-renders are identical).
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

if (location.search.includes("grid")) document.body.classList.add("grid");

// Star maps: grid rings, random stars, a few constellations.
document.querySelectorAll("[data-starmap]").forEach((svg) => {
  const r = rng(+svg.dataset.starmap);
  for (let i = 1; i <= 3; i++) svg.appendChild(el("circle", { r: (99 * i) / 4, class: "grid" }));
  for (let a = 0; a < 180; a += 30) {
    const rad = (a * Math.PI) / 180;
    svg.appendChild(el("line", { x1: -99 * Math.cos(rad), y1: -99 * Math.sin(rad), x2: 99 * Math.cos(rad), y2: 99 * Math.sin(rad), class: "grid" }));
  }
  for (let i = 0; i < 300; i++) {
    const ang = r() * Math.PI * 2, d = Math.sqrt(r()) * 96;
    svg.appendChild(el("circle", { cx: (Math.cos(ang) * d).toFixed(2), cy: (Math.sin(ang) * d).toFixed(2), r: (0.25 + Math.pow(r(), 3) * 1.6).toFixed(2), opacity: (0.4 + r() * 0.6).toFixed(2) }));
  }
  const cons = [
    [[-52, -30], [-38, -44], [-20, -40], [-6, -56], [12, -50]],
    [[26, 16], [40, 4], [56, 10], [64, 28], [48, 38], [26, 16]],
    [[-66, 34], [-50, 48], [-32, 44], [-22, 62]],
    [[4, 54], [18, 40], [14, 22], [30, 70]],
    [[-20, -2], [-6, 8], [8, -6]],
  ];
  cons.forEach((pts) => {
    svg.appendChild(el("polyline", { points: pts.map((p) => p.join(",")).join(" "), class: "con" }));
    pts.forEach((p) => svg.appendChild(el("circle", { cx: p[0], cy: p[1], r: 1.7 })));
  });
});

// Song code bars.
document.querySelectorAll("[data-code]").forEach((box) => {
  const r = rng(+box.dataset.code), n = 23;
  for (let i = 0; i < n; i++) {
    const b = document.createElement("i");
    const anchor = i === 0 || i === n - 1 || i === Math.floor(n / 2);
    b.style.height = (anchor ? 40 : 16 + Math.round(r() * 7) * 12) + "%";
    box.appendChild(b);
  }
});

// Barcodes.
document.querySelectorAll("[data-barcode]").forEach((box) => {
  const r = rng(+box.dataset.barcode);
  for (let i = 0; i < 26; i++) {
    const b = document.createElement("i");
    b.style.width = 1 + Math.round(r() * 2) + "px";
    b.style.marginRight = 1 + Math.round(r() * 1.5) + "px";
    box.appendChild(b);
  }
});

// Calendar month grid (Monday first).
document.querySelectorAll("[data-cal]").forEach((grid) => {
  const [y, m] = grid.dataset.cal.split("-").map(Number);
  const mark = +grid.dataset.mark;
  ["M", "T", "W", "T", "F", "S", "S"].forEach((d) => { const s = document.createElement("span"); s.className = "h"; s.textContent = d; grid.appendChild(s); });
  const first = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  for (let i = 0; i < first; i++) grid.appendChild(document.createElement("span"));
  for (let d = 1; d <= days; d++) {
    const s = document.createElement("span");
    const col = (first + d - 1) % 7;
    s.textContent = d;
    if (col >= 5) s.className = "we";
    if (d === mark) s.className = "mark";
    grid.appendChild(s);
  }
});
