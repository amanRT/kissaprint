"use client";
// A page-turning preview. Wide screens show two-page spreads (cover on its own, then 2-3, 4-5, 6-7, back cover);
// narrow screens show one page at a time, turning away to the left. Buttons, dots, swipe and arrow keys all work.
import { useEffect, useRef, useState } from "react";

type Props = { pages: React.ReactNode[]; label?: string };

export function Flipbook({ pages, label = "Magazine preview" }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const [spread, setSpread] = useState(true);
  const [turned, setTurned] = useState(0); // leaves turned so far
  const [moving, setMoving] = useState<number | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setSpread(el.clientWidth >= 640);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Spreads: leaf k carries page 2k on the front and 2k+1 on the back. Single pages: one leaf per page.
  const leaves = spread
    ? Array.from({ length: Math.ceil(pages.length / 2) }, (_, k) => [pages[2 * k], pages[2 * k + 1]] as const)
    : pages.map((pg) => [pg, null] as const);
  const n = leaves.length;
  const at = Math.min(turned, n - (spread ? 0 : 1));
  useEffect(() => { setTurned((t) => Math.min(t, n - (spread ? 0 : 1))); }, [n, spread]);

  const go = (to: number) => {
    const next = Math.max(0, Math.min(n - (spread ? 0 : 1), to));
    if (next === at) return;
    setMoving(next > at ? at : next); // the leaf that's turning stays on top
    setTurned(next);
    window.setTimeout(() => setMoving(null), 900);
  };

  const where = spread
    ? at === 0 ? "Front cover" : at === n ? "Back cover" : `Pages ${2 * at} - ${2 * at + 1} of ${pages.length}`
    : at === 0 ? "Front cover" : at === n - 1 ? "Back cover" : `Page ${at + 1} of ${pages.length}`;
  const stops = spread ? n + 1 : n;

  return (
    <div className="flip">
      <div ref={stage} className={`flip-stage ${spread ? "is-spread" : "is-single"}`} tabIndex={0} role="region" aria-roledescription="flip-book" aria-label={`${label}: ${where}`}
        onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); go(at + 1); } if (e.key === "ArrowLeft") { e.preventDefault(); go(at - 1); } }}
        onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(at + (dx < 0 ? 1 : -1));
        }}>
        <div className={`flip-book${spread && at === 0 ? " is-closed-front" : ""}${spread && at === n ? " is-closed-back" : ""}`}>
          {leaves.map(([front, back], k) => {
            const flipped = k < at;
            const z = moving === k ? n + 2 : flipped ? k + 1 : n - k + 1;
            const hidden = !(flipped ? k >= at - 1 : k <= at + 1); // only nearby leaves need to be in the accessibility tree
            return (
              <div key={k} className={`flip-leaf${flipped ? " is-flipped" : ""}`} style={{ zIndex: z }} aria-hidden={hidden || undefined} inert={hidden || undefined}>
                <div className="flip-face flip-face--front" aria-hidden={flipped || undefined}>{front}</div>
                <div className={`flip-face flip-face--back${back ? "" : " flip-face--blank"}`} aria-hidden={!flipped || undefined}>{back}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flip-bar">
        <button type="button" className="flip-btn" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous page">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="flip-bar__label" aria-live="polite">{where}</span>
        <button type="button" className="flip-btn" onClick={() => go(at + 1)} disabled={at >= stops - 1} aria-label="Next page">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
      <div className="flip-dots">
        {Array.from({ length: stops }, (_, i) => <button key={i} type="button" aria-label={`Go to ${i === 0 ? "front cover" : i === stops - 1 ? "back cover" : `spread ${i}`}`} aria-current={i === at} onClick={() => go(i)} />)}
      </div>
    </div>
  );
}
