"use client";
// Interactive parts of the home page. Product cards and thumbnails arrive pre-rendered from the server.
import { useEffect, useRef, useState } from "react";

type Item = { key: string; tags: string[]; node: React.ReactNode };

/** Bestseller filter tabs: shows up to 8 cards carrying the selected tag (cards render on the server). */
export function BestsellerTabs({ heading, tabs, items }: { heading: React.ReactNode; tabs: [string, string][]; items: Item[] }) {
  const [active, setActive] = useState(tabs[0][0]);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  let shown = 0;
  const visible = items.map((it) => { const ok = it.tags.includes(active) && shown < 8; if (ok) shown++; return ok; });
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex(([k]) => k === active);
    if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    setActive(tabs[next][0]);
    buttons.current[next]?.focus();
  };
  return (
    <>
      <div className="section-head">
        {heading}
        <div className="tabs" role="tablist" aria-label="Filter bestsellers" onKeyDown={onKey}>
          {tabs.map(([key, label], i) => (
            <button key={key} ref={(el) => { buttons.current[i] = el; }} className="tab" type="button" role="tab" id={`tab-${key}`}
              aria-controls="best-grid" aria-selected={active === key} tabIndex={active === key ? 0 : -1} onClick={() => setActive(key)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="grid-products" id="best-grid" role="tabpanel" aria-labelledby={`tab-${active}`}>
        {items.map((it, i) => <div key={it.key} className="grid-item" hidden={!visible[i]}>{it.node}</div>)}
      </div>
    </>
  );
}

type Photo = { id: string; label: string; full: string; thumb: React.ReactNode };

/** "Design a Memoroid in ten seconds": live preview of photo, frame style and caption. Nothing is uploaded. */
export function MemoroidMaker({ photos, styles, uploadIcon, buy }: { photos: Photo[]; styles: [string, string, string][]; uploadIcon: React.ReactNode; buy: React.ReactNode }) {
  const [photo, setPhoto] = useState(photos[0].id);
  const [own, setOwn] = useState<string | null>(null);
  const [style, setStyle] = useState(styles[0][0]);
  const [caption, setCaption] = useState("us, always");
  useEffect(() => () => { if (own) URL.revokeObjectURL(own); }, [own]);
  const preview = own ?? photos.find((p) => p.id === photo)!.full;
  return (
    <div className="maker__grid">
      <div className="maker__stage">
        <figure className="polaroid memoroid" data-style={style} data-memoroid>
          <img src={preview} width={560} height={560} alt="Live preview of your Memoroid" loading="lazy" decoding="async" data-preview />
          <figcaption data-caption>{caption || " "}</figcaption>
        </figure>
      </div>
      <div>
        <span className="eyebrow">Try it now</span>
        <h2 className="h2" id="maker-title">Design a Memoroid in <span className="serif">ten seconds</span></h2>
        <p className="maker__lead">Pick a photo or use your own, choose a style and write a caption. This is exactly how your print will look.</p>
        <form className="maker__form" action="/products/classic-memoroids/" data-maker onSubmit={(e) => e.preventDefault()}>
          <fieldset>
            <legend><span>1.</span>Pick a photo</legend>
            <div className="swatches">
              {photos.map((p) => (
                <label key={p.id} className="swatch">
                  <input type="radio" name="photo" value={p.id} aria-label={`${p.label} photo`} checked={!own && photo === p.id} onChange={() => { setOwn(null); setPhoto(p.id); }} />
                  {p.thumb}
                </label>
              ))}
              <label className="swatch">
                <input type="file" accept="image/*" aria-label="Upload your own photo" data-upload
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setOwn(URL.createObjectURL(f)); }} />
                <span className="swatch__upload">{uploadIcon}</span>
              </label>
            </div>
            <p className="maker__note">Your photo stays on your device - nothing is uploaded.</p>
          </fieldset>
          <fieldset>
            <legend><span>2.</span>Choose a style</legend>
            <div className="styles">
              {styles.map(([key, label, colour]) => (
                <label key={key} className="style-opt">
                  <input type="radio" name="style" value={key} checked={style === key} onChange={() => setStyle(key)} />
                  <span><i style={{ "--c": colour } as React.CSSProperties} />{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="lbl" htmlFor="maker-caption"><span>3.</span>Write a caption</label>
            <input className="text-input" id="maker-caption" name="caption" maxLength={24} value={caption} onChange={(e) => setCaption(e.target.value)} autoComplete="off" spellCheck={false} />
          </div>
          {buy}
        </form>
      </div>
    </div>
  );
}
