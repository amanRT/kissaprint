"use client";
// Product options, price, photo uploads (straight to storage via one-time links), caption, quantity, add to cart,
// delivery estimate and the sticky mobile buy bar. Port of the original main.js product-page logic.
import { useEffect, useRef, useState } from "react";
import { api, type ApiError } from "@/lib/client-api";
import { inr } from "@/lib/format";
import { useShop } from "../shop/provider";

export type FormProduct = {
  slug: string; name: string; price: number; photos: number; image: string;
  options: { name: string; values: { label: string; price?: number; photos?: number }[]; default: number }[];
};
type Slot = { key: string; url: string; method?: string; headers?: Record<string, string> };
type Photo = { id: string; file: File; name: string; size: number; type: string; url: string; state: "up" | "done" | "err" | "off"; pct: number; key?: string; noprev?: boolean };

const MAX_PHOTOS = 100;
const MAX_BYTES = 25 * 1024 * 1024;
const isPhoto = (f: File) => (f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)) && f.size <= MAX_BYTES;

export function ProductForm({ p, icons, perks }: { p: FormProduct; icons: Record<"upload" | "minus" | "plus" | "pin", React.ReactNode>; perks: React.ReactNode }) {
  const { addToCart, say } = useShop();
  const [choice, setChoice] = useState(p.options.map((o) => o.default));
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [photos, setPhotosState] = useState<Photo[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [pin, setPin] = useState("");
  const [pinOut, setPinOut] = useState<{ ok: boolean; text: string } | null>(null);
  const [stickyVisible, setStickyVisible] = useState(false);
  const photosRef = useRef<Photo[]>([]);
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const addBtn = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);

  const chosen = p.options.map((o, i) => o.values[choice[i]]);
  const unit = chosen.reduce((price, v) => v.price ?? price, p.price);
  const need = chosen.reduce((n, v) => v.photos ?? n, p.photos);
  const count = (s: Photo["state"]) => photos.filter((x) => x.state === s).length;

  const update = (fn: (list: Photo[]) => Photo[]) => { photosRef.current = fn(photosRef.current); setPhotosState(photosRef.current); };
  const patch = (id: string, changes: Partial<Photo>) => update((list) => list.map((x) => (x.id === id ? { ...x, ...changes } : x)));
  const stateOf = (id: string) => photosRef.current.find((x) => x.id === id)?.state;

  const send = (photo: Photo, slot: Slot) => new Promise<void>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhrs.current.set(photo.id, xhr);
    xhr.open(slot.method || "PUT", slot.url);
    Object.entries(slot.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) patch(photo.id, { pct: Math.round((e.loaded / e.total) * 100) }); };
    xhr.onload = () => { patch(photo.id, xhr.status >= 200 && xhr.status < 300 ? { state: "done", key: slot.key } : { state: "err" }); resolve(); };
    xhr.onerror = xhr.onabort = () => { if (stateOf(photo.id)) patch(photo.id, { state: "err" }); resolve(); };
    xhr.send(photo.file);
  });

  // Batches of up to 20 (one API call for the links), three files at a time on the wire.
  const upload = (batch: Photo[]) => {
    chain.current = chain.current.then(async () => {
      const live = batch.filter((x) => stateOf(x.id) === "up");
      if (!live.length) return;
      let slots: Slot[];
      try {
        slots = (await api<{ uploads: Slot[] }>("uploads", { slug: p.slug, files: live.map((x) => ({ name: x.name, type: x.type, size: x.size })) })).uploads;
      } catch (err) {
        live.forEach((x) => patch(x.id, { state: (err as ApiError).status === 503 ? "off" : "err" }));
        return;
      }
      const jobs = live.map((x, i) => [x, slots[i]] as const);
      const worker = async () => { for (let job = jobs.shift(); job; job = jobs.shift()) if (stateOf(job[0].id) === "up") await send(job[0], job[1]); };
      await Promise.all([worker(), worker(), worker()]);
    });
    return chain.current;
  };

  const addPhotos = (files: File[]) => {
    const fit = files.filter(isPhoto);
    if (fit.length < files.length) say("Some files were skipped - photos only, up to 25 MB each");
    const fresh: Photo[] = fit.slice(0, Math.max(0, MAX_PHOTOS - photosRef.current.length)).map((file) => ({
      id: Math.random().toString(36).slice(2), file, name: file.name, size: file.size, type: file.type || "",
      url: URL.createObjectURL(file), state: "up", pct: 0,
    }));
    update((list) => [...list, ...fresh]);
    for (let i = 0; i < fresh.length; i += 20) upload(fresh.slice(i, i + 20));
  };
  const removePhoto = (photo: Photo) => {
    update((list) => list.filter((x) => x.id !== photo.id));
    xhrs.current.get(photo.id)?.abort();
    URL.revokeObjectURL(photo.url);
  };

  useEffect(() => {
    const btn = addBtn.current;
    if (!btn || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setStickyVisible(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(btn);
    return () => io.disconnect();
  }, []);
  useEffect(() => () => photosRef.current.forEach((x) => URL.revokeObjectURL(x.url)), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (waiting) return;
    if (photosRef.current.some((x) => x.state === "up")) {
      setWaiting(true);
      for (let i = 0; i < 100 && photosRef.current.some((x) => x.state === "up"); i++) await chain.current;
      setWaiting(false);
    }
    const opts = Object.fromEntries(p.options.map((o, i) => [o.name, o.values[choice[i]].label]));
    const labels = Object.values(opts);
    const caption = note.trim().slice(0, 60);
    if (caption) labels.push(`“${caption}”`);
    addToCart({
      slug: p.slug, name: p.name, image: p.image, price: unit, qty, options: labels.join(" · "), opts, note: caption, need,
      photos: photosRef.current.filter((x) => x.state === "done" && x.key).map((x) => ({ key: x.key!, name: x.name, size: x.size })),
    });
    photosRef.current.forEach((x) => URL.revokeObjectURL(x.url)); // those photos now belong to that cart line
    update(() => []);
  };

  const checkPin = () => {
    if (!/^[1-9][0-9]{5}$/.test(pin.trim())) { setPinOut({ ok: false, text: "Please enter a valid 6-digit pincode." }); return; }
    const date = new Date();
    for (let added = 0; added < 6;) { date.setDate(date.getDate() + 1); if (date.getDay() !== 0) added++; }
    setPinOut({ ok: true, text: `Get it by ${date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} to ${pin.trim()}` });
  };

  const status = [
    photos.length ? (need ? `${photos.length} of ${need} photos added` : `${photos.length} photo${photos.length === 1 ? "" : "s"} added`) : "",
    count("up") ? `uploading ${count("up")}…` : "",
    count("err") ? `${count("err")} didn't upload - tap ↻ to retry` : "",
    count("off") ? "photo upload is paused right now, so please send them after you order" : "",
  ].filter(Boolean).join(" · ");
  const total = inr(unit * qty);

  return (
    <>
      <form ref={form} className="pdp__form" data-pdp data-slug={p.slug} onSubmit={submit}>
        {p.options.map((opt, oi) => (
          <fieldset className="opt" key={opt.name} data-opt-name={opt.name}>
            <legend>{opt.name}: <output>{opt.values[choice[oi]].label}</output></legend>
            <div className="opt__values">
              {opt.values.map((v, vi) => (
                <label className="choice" key={v.label}>
                  <input type="radio" name={`opt${oi + 1}`} value={v.label} data-price={v.price} data-need={v.photos} checked={choice[oi] === vi}
                    onChange={() => setChoice(choice.map((c, i) => (i === oi ? vi : c)))} />
                  <span>{v.label}{v.price ? <small>{inr(v.price)}</small> : null}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        {p.photos > 0 && (
          <div>
            <span className="field-label">Your photos <span>(<span data-need-out>{need}</span> needed - add them now or send them after you order)</span></span>
            <label className="dropzone" data-dropzone>
              {icons.upload}<strong>{photos.length ? "Add more photos" : "Tap to add photos"}</strong><span>JPG, PNG or HEIC, up to 25 MB each</span>
              <input type="file" accept="image/*" multiple aria-label="Add your photos" data-photo-input
                onChange={(e) => { addPhotos([...(e.target.files ?? [])]); e.target.value = ""; }} />
            </label>
            <div className="previews" data-previews>
              {photos.map((x) => (
                <div key={x.id} className={x.noprev ? "thumb is-noprev" : "thumb"} data-state={x.state} style={{ "--pct": `${x.pct}%` } as React.CSSProperties}>
                  <img alt="" src={x.url} onError={() => patch(x.id, { noprev: true })} />
                  <button type="button" className="thumb__x" aria-label={`Remove ${x.name}`} onClick={() => removePhoto(x)}>×</button>
                  <button type="button" className="thumb__retry" aria-label={`Retry uploading ${x.name}`} onClick={() => { patch(x.id, { state: "up", pct: 0 }); upload([x]); }}>↻</button>
                </div>
              ))}
            </div>
            <p className="photo-status" data-photo-status aria-live="polite">{status}</p>
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="note">Caption or message <span>(optional)</span></label>
          <input className="input" id="note" name="note" maxLength={60} placeholder="e.g. us, always" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="buy-row">
          <div className="qty qty--lg" data-qty>
            <button type="button" aria-label="Decrease quantity" data-step="-1" onClick={() => setQty(Math.max(1, qty - 1))}>{icons.minus}</button>
            <input type="number" name="qty" min={1} max={20} aria-label="Quantity" inputMode="numeric" value={qty}
              onChange={(e) => setQty(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
            <button type="button" aria-label="Increase quantity" data-step="1" onClick={() => setQty(Math.min(20, qty + 1))}>{icons.plus}</button>
          </div>
          <button ref={addBtn} className="btn btn--kiss" type="submit" data-add disabled={waiting}>
            {waiting ? "Uploading your photos…" : <>Add to cart · <span data-price-out>{total}</span></>}
          </button>
        </div>

        <div className="delivery">
          <strong>{icons.pin} Check delivery date</strong>
          <div className="delivery__form">
            <label className="sr-only" htmlFor="pincode">Pincode</label>
            <input className="input" id="pincode" inputMode="numeric" maxLength={6} placeholder="Enter your pincode" autoComplete="postal-code" data-pin
              value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); checkPin(); } }} />
            <button className="btn btn--ghost btn--sm" type="button" data-pin-check onClick={checkPin}>Check</button>
          </div>
          <p className="delivery__out" data-pin-out aria-live="polite" style={pinOut && !pinOut.ok ? { color: "var(--kiss)" } : undefined}>{pinOut?.text}</p>
        </div>
        {perks}
      </form>

      <div className={stickyVisible ? "sticky-buy is-visible" : "sticky-buy"} data-sticky-buy inert={!stickyVisible}>
        <div className="sticky-buy__info"><strong>{p.name}</strong><span data-price-out>{total}</span></div>
        <button className="btn btn--kiss btn--sm" type="button" data-sticky-add onClick={() => form.current?.requestSubmit()}>Add to cart</button>
      </div>
    </>
  );
}
