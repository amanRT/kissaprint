"use client";
// The magazine designer: a full-screen dialog with the flip-book, where every photo spot on every page can take one
// of the shopper's photos. Uploads reuse the product form's machinery (straight to storage); this only decides
// which photo goes where and how it's framed. Loaded on demand, so other product pages never download it.
import { useEffect, useMemo, useRef, useState } from "react";
import { imageUrl } from "@/lib/assets";
import type { Template } from "@/lib/magazine";
import { Flipbook } from "./flipbook";
import { MagazineProvider, PAGES, type SlotPhoto } from "./pages";

export type EditorPhoto = { id: string; url: string; state: "up" | "done" | "err" | "off"; pct: number };
export type Design = Record<string, { photoId: string; x: number; y: number }>;

type Props = {
  template: Template; title: string; photos: EditorPhoto[]; design: Design;
  setDesign: (fn: (d: Design) => Design) => void;
  addPhotos: (files: File[]) => { id: string }[];
  removePhoto: (photoId: string) => void;
  retryPhoto: (photoId: string) => void;
  onClose: () => void;
};

// Faint example pictures in empty spots, so the design makes sense before any photo is added.
const SAMPLES: Record<string, [string, number]> = {
  cover: ["occ-couples", 640], letter: ["pola-couple", 560], "began-main": ["occ-her", 640], "began-polaroid": ["pola-holi", 560],
  feature: ["about-friends", 640], "moment-1": ["festive-diyas", 640], "moment-2": ["pola-family", 560], "moment-3": ["pola-pet", 560],
  "trip-1": ["pola-sunset", 560], "trip-2": ["pola-friends", 560], forever: ["gift-hands", 640], back: ["ugc-wall", 560],
};

export function MagazineEditor({ template, title, photos, design, setDesign, addPhotos, removePhoto, retryPhoto, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const one = useRef<HTMLInputElement>(null);
  const many = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    document.documentElement.classList.add("modal-open");
    return () => document.documentElement.classList.remove("modal-open");
  }, []);

  const byId = useMemo(() => new Map(photos.map((ph) => [ph.id, ph])), [photos]);
  const slotPhotos: Record<string, SlotPhoto | undefined> = {};
  for (const s of template.slots) {
    const d = design[s.id];
    const ph = d && byId.get(d.photoId);
    if (d && ph) slotPhotos[s.id] = { src: ph.url, x: d.x, y: d.y, state: ph.state, pct: ph.pct };
  }
  const samples = Object.fromEntries(template.slots.filter((s) => SAMPLES[s.id]).map((s) => [s.id, imageUrl(SAMPLES[s.id][0], SAMPLES[s.id][1], "webp")]));
  const filled = template.slots.filter((s) => slotPhotos[s.id]).length;
  const empty = template.slots.filter((s) => !slotPhotos[s.id]).map((s) => s.id);

  const put = (slot: string, file: File) => {
    const [ph] = addPhotos([file]);
    if (!ph) return;
    const old = design[slot]?.photoId;
    if (old) removePhoto(old);
    setDesign((d) => ({ ...d, [slot]: { photoId: ph.id, x: 50, y: 50 } }));
  };
  const pick = (slot: string) => {
    if (slotPhotos[slot] && active !== slot) { setActive(slot); return; }
    target.current = slot;
    one.current?.click();
  };
  const remove = (slot: string) => {
    const old = design[slot]?.photoId;
    if (old) removePhoto(old);
    setDesign((d) => { const next = { ...d }; delete next[slot]; return next; });
    setActive(null);
  };
  const fill = (files: File[]) => {
    const slots = [...empty];
    const added = addPhotos(files.slice(0, slots.length));
    setDesign((d) => {
      const next = { ...d };
      added.forEach((ph, i) => { next[slots[i]] = { photoId: ph.id, x: 50, y: 50 }; });
      return next;
    });
    setActive(null);
  };

  const Pages = PAGES[template.id] ?? [];
  return (
    <dialog ref={dialog} className="mag-editor" aria-labelledby="mag-editor-title" onClose={onClose} onCancel={() => onClose()}
      onClick={(e) => { if (!(e.target as HTMLElement).closest(".mag-slot")) setActive(null); }}>
      <div className="mag-editor__top">
        <h2 id="mag-editor-title">Design your magazine</h2>
        <span className={`mag-editor__count${filled === template.slots.length ? " is-done" : ""}`} aria-live="polite">{filled} of {template.slots.length} photos</span>
        <div className="mag-editor__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => many.current?.click()} disabled={!empty.length}>
            {empty.length ? `Add photos (${empty.length} empty)` : "Every spot is filled"}
          </button>
          <button type="button" className="btn btn--kiss btn--sm" onClick={() => dialog.current?.close()} data-editor-done>Done</button>
        </div>
      </div>
      <div className="mag-editor__main" data-editable>
        <MagazineProvider value={{ photos: slotPhotos, title, samples, editable: true, active, onPick: pick, onReplace: (id) => { target.current = id; one.current?.click(); },
          onRemove: remove, onMove: (id, x, y) => setDesign((d) => (d[id] ? { ...d, [id]: { ...d[id], x, y } } : d)),
          onRetry: (id) => { const pid = design[id]?.photoId; if (pid) retryPhoto(pid); } }}>
          <Flipbook pages={Pages.map((P, i) => <P key={i} />)} label="Your magazine" />
        </MagazineProvider>
      </div>
      <p className="mag-editor__hint">Tap a spot to add a photo · drag a photo to frame it · tap it again to replace or remove · your caption goes on the cover</p>
      <input ref={one} type="file" accept="image/*" hidden aria-label="Choose a photo for this spot" data-slot-input
        onChange={(e) => { const f = e.target.files?.[0]; if (f && target.current) put(target.current, f); e.target.value = ""; setActive(null); }} />
      <input ref={many} type="file" accept="image/*" multiple hidden aria-label="Add photos to the empty spots" data-fill-input
        onChange={(e) => { fill([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </dialog>
  );
}
