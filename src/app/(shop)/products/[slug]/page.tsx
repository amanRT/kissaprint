import { notFound } from "next/navigation";
import { Fragment } from "react";
import { preload } from "react-dom";
import { ProductForm } from "@/components/product/form";
import { Gallery } from "@/components/product/gallery";
import { Badges, Breadcrumbs, Icon, Img, JsonLd, pictureWidths, Price, ProductCard, ReviewCard, Stars } from "@/components/ui";
import { image, imageUrl, srcset } from "@/lib/assets";
import { categoriesBySlug, products, productsBySlug, reviews, site } from "@/lib/catalog";
import { inr } from "@/lib/format";
import { clip, ldBreadcrumbs, ldProduct, pageMeta } from "@/lib/seo";
import { hiddenProducts, shopVisibility } from "@/lib/server/visibility";

type Props = { params: Promise<{ slug: string }> };
const SIZES = "(min-width: 1360px) 620px, (min-width: 960px) 46vw, 100vw";

export const dynamicParams = false;
export const generateStaticParams = () => products.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: Props) {
  const p = productsBySlug[(await params).slug];
  if (!p) return {};
  const cat = categoriesBySlug[p.category];
  return pageMeta({
    title: p.name.length < 26 ? `${p.name} - Personalised ${cat.name} | KissaPrints` : `${p.name} | KissaPrints`,
    description: clip(`${p.short} ${p.meta}. From ₹${p.price.toLocaleString("en-IN")}, delivered across India.`),
    path: p.url, ogImage: imageUrl(p.slug, 1200, "webp"), ogImageAlt: p.name,
    noindex: (await hiddenProducts()).has(p.slug), // switched off in /admin/products/: out of search results until it's back
  });
}

const tint = (t: string) => ({ "--tint": `var(--${t})` }) as React.CSSProperties;

export default async function ProductPage({ params }: Props) {
  const p = productsBySlug[(await params).slug];
  if (!p) notFound();
  const cat = categoriesBySlug[p.category];
  const crumbs: [string, string][] = [["Home", "/"], [cat.name, cat.url], [p.name, p.url]];
  // Switched off in /admin/products/ (e.g. out of stock): the page stays, so shared links still work, but it can't be ordered.
  const vis = await shopVisibility();
  const unavailable = !vis.product(p.slug);
  const shown = vis.products(products);
  const i = Math.max(0, shown.indexOf(p));
  const sameCat = shown.filter((x) => x.category === p.category && x.slug !== p.slug);
  const others = shown.filter((x) => x.category !== p.category);
  const related = [...sameCat, ...others.slice(i % Math.max(1, others.length)), ...others].filter((x, n, all) => all.indexOf(x) === n).slice(0, 4);
  const productReviews = [...reviews.filter((r) => r.product === p.slug), ...reviews.filter((r) => r.product !== p.slug && vis.product(r.product))];

  const middle = (g: string) => { const ws = pictureWidths(g); return ws[Math.floor(ws.length / 2)]; };
  const gallery = p.gallery.map((g, n) => {
    const im = image(g);
    const ws = pictureWidths(g);
    return { avif: srcset(g, "avif", ws), webp: srcset(g, "webp", ws), src: imageUrl(g, middle(g), "webp"), width: im.width, height: im.height,
      alt: n === 0 ? `${p.name} - ${p.meta}` : `${p.name} - image ${n + 1}`, thumb: <Img name={g} alt="" sizes="76px" w={76} h={76} /> };
  });
  // The first gallery image is the LCP element: start fetching it before the browser even parses <body>.
  preload(imageUrl(p.gallery[0], middle(p.gallery[0]), "avif"), { as: "image", type: "image/avif", imageSrcSet: gallery[0].avif, imageSizes: SIZES, fetchPriority: "high" });

  return (
    <>
      <JsonLd data={[ldProduct(p, !unavailable), ldBreadcrumbs(crumbs)]} />
      <div className="wrap">
        <div className="pdp">
          <Gallery images={gallery} sizes={SIZES} badges={<Badges p={p} />} />
          <div className="pdp__info">
            <Breadcrumbs items={crumbs} />
            <h1>{p.name}</h1>
            <a className="pdp__rating" href="#reviews"><Stars rating={p.rating} /> {p.rating} <span>{p.reviews.toLocaleString("en-IN")} reviews</span></a>
            <div className="pdp__price">
              <Price price={p.price} mrp={p.mrp} />
              <p className="tax-note">Inclusive of all taxes · {p.meta}</p>
            </div>
            <p className="pdp__short">{p.short}</p>
            {unavailable ? (
              <div className="pdp__unavailable" role="status">
                <strong>Currently unavailable</strong>
                <p>We&apos;ve paused orders for {p.name} for now. Have a look at similar gifts below, or <a href="/contact/">ask us</a> when it&apos;s back.</p>
                {vis.url(cat.url)
                  ? <a className="btn btn--kiss" href={cat.url}>See more {cat.name.toLowerCase()} <Icon name="arrow-right" className="icon--arrow" /></a>
                  : <a className="btn btn--kiss" href="/shop/">See all gifts <Icon name="arrow-right" className="icon--arrow" /></a>}
              </div>
            ) : <ProductForm
              p={{ slug: p.slug, name: p.name, price: p.price, photos: p.photos, image: imageUrl(p.slug, 360, "webp"),
                options: p.options.map((o, n) => ({ name: o.name, values: o.values, default: p.defaults[n] })) }}
              icons={{ upload: <Icon name="upload" />, minus: <Icon name="minus" />, plus: <Icon name="plus" />, pin: <Icon name="map-pin" /> }}
              perks={
                <ul className="perks">
                  <li className="perk"><Icon name="truck" />Free shipping over {inr(site.free_shipping_over)}</li>
                  <li className="perk"><Icon name="gift" />Gift-ready packing</li>
                  <li className="perk"><Icon name="refresh" />Free reprint if damaged</li>
                </ul>
              }
            />}
            <div className="accordion pdp__details">
              <details open><summary>Description<span className="plus" aria-hidden="true" /></summary><div className="answer"><p>{p.description}</p></div></details>
              <details><summary>Specifications<span className="plus" aria-hidden="true" /></summary><div className="answer"><dl className="specs">{p.specs.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl></div></details>
              <details><summary>Shipping &amp; reprints<span className="plus" aria-hidden="true" /></summary><div className="answer"><p>Printed and dispatched within {site.dispatch}, delivered across India in {site.delivery}. If anything arrives damaged or misprinted, send us a photo within 48 hours and we&apos;ll reprint it free. <a href="/shipping/">Shipping details</a></p></div></details>
              <details><summary>Care<span className="plus" aria-hidden="true" /></summary><div className="answer"><p>Keep prints away from direct sunlight and moisture to enjoy them for years. Wipe acrylic and metal products with a soft, dry cloth.</p></div></details>
            </div>
          </div>
        </div>
      </div>

      <section className="section" aria-labelledby="how-title">
        <div className="wrap">
          <div className="section-head"><div className="section-head__text"><span className="eyebrow">How it works</span><h2 className="h2" id="how-title">Your {p.name}, <span className="serif accent">made in three steps</span></h2></div></div>
          <ol className="steps">
            <li className="step" style={tint("blush")}><div className="step__top"><span className="step__icon"><Icon name="image" /></span><span className="step__num" data-num="01" aria-hidden="true" /></div><h3>Choose &amp; personalise</h3><p>Pick your options and add a caption or message.</p></li>
            <li className="step" style={tint("sky")}><div className="step__top"><span className="step__icon"><Icon name="upload" /></span><span className="step__num" data-num="02" aria-hidden="true" /></div><h3>Send your photos</h3><p>Upload them here, or {site.whatsapp ? "WhatsApp" : "email"} them to us after checkout.</p></li>
            <li className="step" style={tint("butter")}><div className="step__top"><span className="step__icon"><Icon name="package" /></span><span className="step__num" data-num="03" aria-hidden="true" /></div><h3>We print &amp; ship</h3><p>Checked by a human, printed with care, shipped in {site.dispatch}.</p></li>
          </ol>
        </div>
      </section>

      <section className="section section--flush-top" id="reviews" aria-labelledby="rev-title">
        <div className="wrap">
          <div className="section-head">
            <div className="section-head__text"><span className="eyebrow">Reviews</span><h2 className="h2" id="rev-title">What gifters are saying</h2></div>
            <div className="score-card"><span className="score">{p.rating}</span><div><Stars rating={p.rating} /><p>from {p.reviews.toLocaleString("en-IN")} reviews</p></div></div>
          </div>
          <ul className="carousel" id="rev-list">{productReviews.map((r) => <ReviewCard key={r.name} r={r} />)}</ul>
        </div>
      </section>

      <section className="section section--flush-top" aria-labelledby="also-title">
        <div className="wrap">
          <div className="section-head"><div className="section-head__text"><h2 className="h2" id="also-title">You may also <span className="serif accent">love</span></h2></div><a className="link-arrow" href="/shop/">Shop all gifts <Icon name="arrow-right" /></a></div>
          <div className="grid-products">{related.map((r) => <ProductCard key={r.slug} p={r} />)}</div>
        </div>
      </section>
    </>
  );
}
