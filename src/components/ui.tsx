// Small presentational building blocks (server components; no client JS). Ported from templates/macros.html.
import { preload } from "react-dom";
import { image, imageUrl, srcset } from "@/lib/assets";
import { productsBySlug, type Product, type Review } from "@/lib/catalog";
import { inr } from "@/lib/format";
import { Icon } from "./icon";
import { SPRITE } from "./icon-sprite";
import { WishButton } from "./wish-button";

export { Icon };

export function IconSprite() {
  return <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: SPRITE }} />;
}

export function LogoLink({ label = "KissaPrints home", href = "/" }: { label?: string; href?: string }) {
  return (
    <a className="logo" href={href} aria-label={label}>
      <svg className="logo__mark" aria-hidden="true"><use href="#logo-mark" /></svg>
      <span className="logo__word" aria-hidden="true"><em>kissa</em>prints</span>
    </a>
  );
}

export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <>
      {(Array.isArray(data) ? data : [data]).map((d, i) => (
        // "<" escaped so text in the data can never close the script tag
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, "\\u003c") }} />
      ))}
    </>
  );
}

type PictureProps = { name: string; alt: string; sizes?: string; priority?: boolean; className?: string; widths?: number[]; imgProps?: Record<string, string> };

/** Widths below this only exist for thumbnails (<Img>); a full <Picture> never needs them. */
export const THUMB_ONLY = 200;

/** Widths worth offering: every srcset candidate is repeated in the HTML and the RSC payload. */
export function pictureWidths(name: string, widths?: number[]) {
  const all = image(name).widths;
  const picked = all.filter((w) => (widths ? widths.includes(w) : w >= THUMB_ONLY));
  return picked.length ? picked : all;
}

/** Responsive AVIF + WebP <picture>. priority = the LCP image: preloaded, high fetch priority, never lazy. */
export function Picture({ name, alt, sizes = "100vw", priority = false, className, widths, imgProps }: PictureProps) {
  const im = image(name);
  const ws = pictureWidths(name, widths);
  const fallback = ws[Math.floor(ws.length / 2)];
  if (priority) preload(imageUrl(name, fallback, "avif"), { as: "image", type: "image/avif", imageSrcSet: srcset(name, "avif", ws), imageSizes: sizes, fetchPriority: "high" });
  return (
    <picture>
      <source type="image/avif" srcSet={srcset(name, "avif", ws)} sizes={sizes} />
      <img src={imageUrl(name, fallback, "webp")} srcSet={srcset(name, "webp", ws)} sizes={sizes} width={im.width} height={im.height} alt={alt}
        {...(priority ? { fetchPriority: "high" as const } : { loading: "lazy" as const })} decoding="async" className={className} {...imgProps} />
    </picture>
  );
}

type ImgProps = { name: string; alt: string; sizes: string; w?: number; h?: number; className?: string; eager?: boolean; max?: number };

/** Plain WebP <img> for small thumbnails (avatars, menus, cart). Only offers widths up to the first one that
 *  covers 1.5x the display size (`max`, or a plain "46px" sizes value), since browsers pick the smallest
 *  candidate that's big enough - a 76px thumbnail shouldn't download a 360px image. */
export function Img({ name, alt, sizes, w, h, className, eager, max }: ImgProps) {
  const im = image(name);
  const px = max ?? (/^\d+px$/.test(sizes) ? parseInt(sizes, 10) : 0);
  const enough = px ? im.widths.find((x) => x >= px * 1.5) : undefined;
  const ws = enough ? im.widths.filter((x) => x <= enough) : im.widths;
  return (
    <img src={imageUrl(name, ws[0], "webp")} srcSet={srcset(name, "webp", ws)} sizes={sizes} width={w ?? im.width} height={h ?? im.height}
      alt={alt} loading={eager ? undefined : "lazy"} decoding="async" className={className} />
  );
}

export function Stars({ rating, label = true }: { rating: number; label?: boolean }) {
  const style = { "--pct": `${Math.round((rating / 5) * 1000) / 10}%` } as React.CSSProperties;
  return label
    ? <span className="stars" style={style} role="img" aria-label={`Rated ${rating} out of 5`} />
    : <span className="stars" style={style} aria-hidden="true" />;
}

export function Price({ price, mrp }: { price: number; mrp?: number }) {
  return (
    <p className="price">
      <span className="price__now">{inr(price)}</span>
      {mrp && mrp > price ? (
        <>
          {" "}<s className="price__was"><span className="sr-only">MRP </span>{inr(mrp)}</s>{" "}
          <span className="price__off">{Math.round(((mrp - price) / mrp) * 100)}% off</span>
        </>
      ) : null}
    </p>
  );
}

const BADGE_LABELS: Record<string, string> = { bestseller: "Bestseller", new: "New" };

export function Badges({ p }: { p: Product }) {
  if (!p.badges.length) return null;
  return <div className="card__badges">{p.badges.map((b) => <span key={b} className={`badge badge--${b}`}>{BADGE_LABELS[b]}</span>)}</div>;
}

export const CARD_SIZES = "(min-width: 1360px) 310px, (min-width: 1100px) 23vw, (min-width: 768px) 31vw, 46vw";
/** Cards are at most 310 CSS px wide: 360w covers 1x screens, 640w covers 2x-3x phones. */
const CARD_WIDTHS = [360, 640];

export function ProductCard({ p, priority = false }: { p: Product; priority?: boolean }) {
  return (
    <article className="card">
      <div className="card__media">
        <Picture name={p.slug} alt={`${p.name} - ${p.meta}`} sizes={CARD_SIZES} widths={CARD_WIDTHS} priority={priority} />
        <Badges p={p} />
        <span className="card__quick" aria-hidden="true">Personalise <Icon name="arrow-right" /></span>
      </div>
      <WishButton slug={p.slug} name={p.name} />
      <div className="card__body">
        <h3 className="card__title"><a href={p.url}>{p.name}</a></h3>
        <p className="card__meta">{p.meta}</p>
        <p className="rating">
          <Stars rating={p.rating} label={false} />
          <span className="sr-only">Rated {p.rating} out of 5 from {p.reviews.toLocaleString("en-IN")} reviews</span>
          <span aria-hidden="true"><b>{p.rating}</b> ({p.reviews.toLocaleString("en-IN")})</span>
        </p>
        <Price price={p.price} mrp={p.mrp} />
      </div>
    </article>
  );
}

export function Breadcrumbs({ items }: { items: [string, string][] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map(([label, url], i) => (
          <li key={url}>{i === items.length - 1 ? <span aria-current="page">{label}</span> : <a href={url}>{label}</a>}</li>
        ))}
      </ol>
    </nav>
  );
}

export function ReviewCard({ r }: { r: Review }) {
  const p = productsBySlug[r.product];
  return (
    <li className="review">
      <Stars rating={r.rating} />
      <blockquote><p>“{r.text}”</p></blockquote>
      <div className="review__who">
        <span className="avatar" style={{ "--tint": `var(--${r.tint})` } as React.CSSProperties} aria-hidden="true">{r.name[0]}</span>
        <div><strong>{r.name}</strong><span>{r.city} · <span className="verified"><Icon name="check" /> Verified buyer</span></span></div>
      </div>
      <a className="review__product" href={p.url}><Img name={p.slug} alt="" sizes="46px" w={46} h={46} /><span>{p.name}</span></a>
    </li>
  );
}
