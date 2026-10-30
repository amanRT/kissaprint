"use client";
// "Kissa" - the 8-page personalised magazine (an original KissaPrints design). Pages are plain HTML/CSS laid out in
// percentages and container units, so the same markup is the editor, the flip-book preview and the A4 print view.
// Photo spots (<Slot>) match the ids in lib/magazine.ts; only photos are personal, plus the caption on the cover.
import { createContext, useContext, useRef } from "react";
import "@/styles/magazine.css";

export type SlotPhoto = { src: string; x: number; y: number; state?: "up" | "done" | "err" | "off"; pct?: number };
type Ctx = {
  photos: Record<string, SlotPhoto | undefined>;
  title: string;
  /** Sample pictures shown faintly in empty spots, so the design reads before any photo is added. */
  samples?: Record<string, string>;
  editable?: boolean;
  active?: string | null;
  onPick?: (id: string) => void;
  onReplace?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
};
const MagCtx = createContext<Ctx>({ photos: {}, title: "" });
export const MagazineProvider = MagCtx.Provider;

type Box = { x: number; y: number; w: number; h: number; r?: number };
const place = ({ x, y, w, h, r }: Box): React.CSSProperties => ({ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, transform: r ? `rotate(${r}deg)` : undefined });

/** A photo spot. Edit mode: tap an empty spot to add a photo; drag a filled one to frame it, tap it for Replace / Remove. */
function Slot({ id, label, box, frame }: { id: string; label: string; box: Box; frame?: "polaroid" | "round" }) {
  const c = useContext(MagCtx);
  const photo = c.photos[id];
  const drag = useRef<{ px: number; py: number; x: number; y: number; w: number; h: number; moved: boolean } | null>(null);
  const sample = !photo && c.samples?.[id];

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!c.editable || !photo) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { px: e.clientX, py: e.clientY, x: photo.x, y: photo.y, w: r.width, h: r.height, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation(); // not a page swipe
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    const clamp = (n: number) => Math.min(100, Math.max(0, n));
    c.onMove?.(id, clamp(d.x - (dx / d.w) * 100), clamp(d.y - (dy / d.h) * 100)); // drag right = see more of the left side
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) c.onPick?.(id);
  };

  return (
    <div className={`mag-slot${frame ? ` mag-slot--${frame}` : ""}${c.active === id ? " is-active" : ""}`} style={place(box)}>
      <div className="mag-slot__photo" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}
        data-slot={id} data-filled={photo ? "" : undefined}>
        {photo ? <img src={photo.src} alt="" draggable={false} style={{ objectPosition: `${photo.x}% ${photo.y}%` }} />
          : sample ? <img src={sample} alt="" draggable={false} className="is-sample" /> : null}
        {c.editable && !photo && (
          <button type="button" className="mag-slot__add" onClick={(e) => { e.stopPropagation(); c.onPick?.(id); }} aria-label={`Add a photo: ${label}`}>
            <span aria-hidden="true">+</span>{label}
          </button>
        )}
        {c.editable && photo?.state === "up" && <span className="mag-slot__state" style={{ "--pct": `${photo.pct ?? 0}%` } as React.CSSProperties}>Uploading…</span>}
        {c.editable && (photo?.state === "err" || photo?.state === "off") && (
          <button type="button" className="mag-slot__state is-err" onClick={(e) => { e.stopPropagation(); c.onRetry?.(id); }}>
            {photo.state === "off" ? "Upload paused" : "Didn't upload - tap to retry"}
          </button>
        )}
      </div>
      {c.editable && photo && c.active === id && (
        <div className="mag-slot__bar">
          <button type="button" onClick={() => (c.onReplace ?? c.onPick)?.(id)}>Replace</button>
          <button type="button" onClick={() => c.onRemove?.(id)}>Remove</button>
        </div>
      )}
    </div>
  );
}

function T({ box, className, children, style }: { box: Partial<Box> & { x: number; y: number }; className?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className={`mag-t ${className ?? ""}`} style={{ left: `${box.x}%`, top: `${box.y}%`, width: box.w ? `${box.w}%` : undefined, transform: box.r ? `rotate(${box.r}deg)` : undefined, ...style }}>{children}</div>;
}
const Folio = ({ n, light }: { n: number; light?: boolean }) => (
  <div className={`mag-folio${light ? " is-light" : ""}`}><span>{String(n).padStart(2, "0")}</span><span>Kissa · Special edition</span></div>
);
const title = (t: string) => t.trim() || "Our Story";

function Cover() {
  const { title: t } = useContext(MagCtx);
  return (
    <div className="mag-page mag-page--cover">
      <Slot id="cover" label="Cover photo" box={{ x: 0, y: 0, w: 100, h: 100 }} />
      <div className="mag-shade mag-shade--top" /><div className="mag-shade mag-shade--bottom" />
      <T box={{ x: 6, y: 2.5, w: 88 }} className="mag-masthead">Kissa</T>
      <T box={{ x: 63, y: 4.2, w: 31 }} className="mag-kicker is-light mag-right">The love issue<br />Vol. 01</T>
      <T box={{ x: 7, y: 31, w: 30 }} className="mag-coverline">12 moments<br />worth framing</T>
      <T box={{ x: 7, y: 41, w: 30 }} className="mag-coverline is-small">+ the story<br />behind every one</T>
      <T box={{ x: 7, y: 69 }} className="mag-tag">Exclusive</T>
      <T box={{ x: 7, y: 74, w: 86 }} className="mag-cover-title">{title(t)}</T>
      <T box={{ x: 7, y: 87.5, w: 60 }} className="mag-cover-sub">The photos, the places and the people behind it all</T>
      <div className="mag-barcode" style={place({ x: 76, y: 86.5, w: 17, h: 8 })} />
    </div>
  );
}

function Letter() {
  const { title: t } = useContext(MagCtx);
  return (
    <div className="mag-page">
      <T box={{ x: 8, y: 6, w: 84 }} className="mag-kicker mag-rule">From the editors</T>
      <T box={{ x: 8, y: 11, w: 84 }} className="mag-h1">Dear reader,</T>
      <Slot id="letter" label="Editor's letter" box={{ x: 8, y: 25, w: 84, h: 38 }} frame="round" />
      <T box={{ x: 8, y: 66.5, w: 84 }} className="mag-body mag-dropcap">
        Every great story deserves a cover. This one began with a single photo and grew into a whole issue - the late-night
        talks, the first trips, the in-jokes and the quiet, ordinary days that turned out to be the best ones. Turn the page.
        It&apos;s all in here.
      </T>
      <T box={{ x: 8, y: 84, w: 84 }} className="mag-hand mag-sign">with love, {title(t)}</T>
      <Folio n={2} />
    </div>
  );
}

function Began() {
  return (
    <div className="mag-page mag-page--blush">
      <T box={{ x: 8, y: 6 }} className="mag-kicker is-red">Chapter one</T>
      <T box={{ x: 8, y: 10, w: 84 }} className="mag-h1">How it<br />all began</T>
      <Slot id="began-main" label="How it began" box={{ x: 8, y: 30, w: 60, h: 42 }} />
      <Slot id="began-polaroid" label="Polaroid" box={{ x: 52, y: 56, w: 40, h: 33, r: 5 }} frame="polaroid" />
      <T box={{ x: 56, y: 84.8, w: 34, r: 5 }} className="mag-hand mag-center">the day it started</T>
      <T box={{ x: 8, y: 75.5, w: 40 }} className="mag-body is-small">
        Nobody plans the beginning. It just happens - and only later do you realise that was the moment everything changed.
      </T>
      <Folio n={3} />
    </div>
  );
}

function Feature() {
  return (
    <div className="mag-page mag-page--ink">
      <Slot id="feature" label="Feature" box={{ x: 0, y: 0, w: 56, h: 100 }} />
      <T box={{ x: 61, y: 8 }} className="mag-kicker is-butter">The feature</T>
      <T box={{ x: 61, y: 14, w: 34 }} className="mag-quote">&ldquo;Some stories you live once - and keep forever.&rdquo;</T>
      <T box={{ x: 61, y: 58, w: 33 }} className="mag-body is-light is-small">
        The laughs that still make us cry, the plans that went sideways, and the ones that went perfectly. This is the
        chapter we&apos;d read again and again.
      </T>
      <T box={{ x: 61, y: 80, w: 33 }} className="mag-kicker is-light">Read on, page 05</T>
      <Folio n={4} light />
    </div>
  );
}

function Moments() {
  return (
    <div className="mag-page">
      <T box={{ x: 8, y: 6 }} className="mag-kicker">A photo essay</T>
      <T box={{ x: 8, y: 10, w: 84 }} className="mag-h1">Little moments</T>
      <Slot id="moment-1" label="Little moment 1" box={{ x: 8, y: 22, w: 84, h: 35 }} />
      <Slot id="moment-2" label="Little moment 2" box={{ x: 8, y: 60, w: 40, h: 27 }} />
      <Slot id="moment-3" label="Little moment 3" box={{ x: 52, y: 60, w: 40, h: 27 }} />
      <T box={{ x: 8, y: 88.3, w: 84 }} className="mag-caption">The in-between bits - the ones we never planned to photograph, and now can&apos;t stop looking at.</T>
      <Folio n={5} />
    </div>
  );
}

function Trips() {
  return (
    <div className="mag-page mag-page--sky">
      <T box={{ x: 8, y: 6 }} className="mag-kicker is-red">On the road</T>
      <T box={{ x: 8, y: 10, w: 84 }} className="mag-h1">Adventures,<br />together</T>
      <Slot id="trip-1" label="Adventure 1" box={{ x: 8, y: 30, w: 48, h: 36, r: -4 }} frame="polaroid" />
      <Slot id="trip-2" label="Adventure 2" box={{ x: 42, y: 50, w: 50, h: 37, r: 4 }} frame="polaroid" />
      <div className="mag-stamp" style={place({ x: 66, y: 24, w: 24, h: 17, r: 12 })}><span>Miles<br />&amp; smiles</span></div>
      <T box={{ x: 8, y: 71, w: 30, r: -4 }} className="mag-hand">next stop: everywhere</T>
      <Folio n={6} />
    </div>
  );
}

function Forever() {
  return (
    <div className="mag-page mag-page--ink">
      <Slot id="forever" label="Forever" box={{ x: 0, y: 0, w: 100, h: 100 }} />
      <div className="mag-shade mag-shade--bottom is-deep" />
      <T box={{ x: 8, y: 66 }} className="mag-kicker is-butter">The last word</T>
      <T box={{ x: 8, y: 71, w: 84 }} className="mag-quote is-big">Forever has a nice ring to it.</T>
      <Folio n={7} light />
    </div>
  );
}

function Back() {
  return (
    <div className="mag-page mag-page--butter">
      <Slot id="back" label="Back cover" box={{ x: 17, y: 12, w: 66, h: 50, r: -2 }} frame="polaroid" />
      <T box={{ x: 8, y: 67, w: 84 }} className="mag-h1 mag-center">The end.</T>
      <T box={{ x: 8, y: 75, w: 84 }} className="mag-hand mag-center is-big">(or just the beginning)</T>
      <T box={{ x: 8, y: 88, w: 50 }} className="mag-mini-mast">Kissa</T>
      <T box={{ x: 8, y: 93, w: 50 }} className="mag-caption">Printed with love by KissaPrints</T>
      <div className="mag-barcode" style={place({ x: 75, y: 87, w: 17, h: 8 })} />
    </div>
  );
}

/** The pages of each template (lib/magazine.ts) in order; index = page number - 1. */
export const PAGES: Record<string, React.ComponentType[]> = { "kissa-8": [Cover, Letter, Began, Feature, Moments, Trips, Forever, Back] };
