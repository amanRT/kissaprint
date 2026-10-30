// The listing page used by /shop/, /collections/<slug>/ and /gifts/<slug>/ (server component).
import { site, type Category, type Product } from "@/lib/catalog";
import { inr } from "@/lib/format";
import { ldBreadcrumbs, ldItemList } from "@/lib/seo";
import { Breadcrumbs, Icon, JsonLd, Picture, ProductCard } from "../ui";
import { CollectionResults } from "./results";

export type CollectionProps = {
  path: string; heading: string; intro: string; items: Product[]; crumbs: [string, string][];
  seoTitle: string; seoParas: string[]; related: Category[]; chips: [string, string][];
};

export function CollectionPage({ path, heading, intro, items, crumbs, seoTitle, seoParas, related, chips }: CollectionProps) {
  return (
    <div className="wrap">
      <JsonLd data={[ldBreadcrumbs(crumbs), ldItemList(items)]} />
      <header className="plp-hero">
        <div>
          <Breadcrumbs items={crumbs} />
          <h1 data-plp-title>{heading}</h1>
          <p className="lead">{intro}</p>
        </div>
        <div className="plp-hero__stats">
          <span className="stat-pill"><Icon name="truck" />Free shipping over {inr(site.free_shipping_over)}</span>
          <span className="stat-pill"><Icon name="clock" />Dispatch in {site.dispatch}</span>
          <span className="stat-pill"><Icon name="gift" />Gift-ready packing</span>
        </div>
      </header>

      <CollectionResults
        heading={heading}
        chips={
          <nav aria-label="Browse by category" className="chips">
            {chips.map(([label, url]) => <a key={url} className="chip-link" href={url} aria-current={url === path ? "page" : undefined}>{label}</a>)}
          </nav>
        }
        items={items.map((p, i) => ({ key: p.slug, price: p.price, rating: p.rating, search: p.search, node: <ProductCard p={p} priority={i === 0} /> }))}
      />

      <section className="seo-block" aria-labelledby="about-collection">
        <h2 id="about-collection">{seoTitle}</h2>
        <div>{seoParas.map((para) => <p key={para}>{para}</p>)}</div>
      </section>

      {related.length > 0 && (
        <section className="section" aria-labelledby="related-title" style={{ paddingBottom: 0 }}>
          <div className="section-head"><div className="section-head__text"><h2 className="h2" id="related-title">Keep <span className="serif accent">exploring</span></h2></div></div>
          <ul className="cats">
            {related.map((c) => (
              <li key={c.slug}><a className="cat" href={c.url}><span className="cat__img"><Picture name={c.image} alt="" sizes="(min-width: 1360px) 200px, (min-width: 900px) 14vw, 128px" widths={[360, 640]} /></span><span className="cat__name">{c.name}</span><span className="cat__sub">{c.sub}</span></a></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
