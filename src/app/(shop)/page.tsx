import { BestsellerTabs, MemoroidMaker } from "@/components/home/islands";
import { CarouselButtons, DemoForm } from "@/components/shop/bits";
import { PhoneLinks } from "@/components/shop/chrome";
import { Icon, Img, JsonLd, Picture, ProductCard, ReviewCard, Stars } from "@/components/ui";
import { imageUrl } from "@/lib/assets";
import { categories, faqs, occasions, products, productsByReviews, productsBySlug, reviews, site } from "@/lib/catalog";
import { inr } from "@/lib/format";
import { ldFaq, ldOrg, ldWebsite, pageMeta } from "@/lib/seo";
import { shopVisibility } from "@/lib/server/visibility";

export const metadata = pageMeta({
  title: "Personalised Photo Gifts & Polaroid Prints | KissaPrints",
  description: "Turn your photos into personalised gifts: polaroid prints, photo strips, song plaques, star maps, magazines & hampers. Made in India, delivered fast.",
  path: "/",
});

const tint = (t: string) => ({ "--tint": `var(--${t})` }) as React.CSSProperties;
const CAT_SIZES = "(min-width: 1360px) 200px, (min-width: 900px) 14vw, 128px";

export default async function HomePage() {
  // Products switched off in /admin/products/ drop out of the tabs and reviews, categories/occasions they empty
  // drop out of the tiles, and the sections built around one product hide.
  const vis = await shopVisibility();
  const on = vis.product;
  const cal = productsBySlug["memories-calendar-2027"];
  const mag = productsBySlug["personalised-magazine"];
  const memo = productsBySlug["classic-memoroids"];
  const heart = <Icon name="heart" />;
  return (
    <>
      <JsonLd data={[ldOrg(), ldWebsite(), ldFaq(faqs)]} />
      <section className="hero" aria-labelledby="hero-title">
        <div className="wrap hero__grid">
          <div className="hero__copy">
            {on(cal.slug) && <a className="pill-link" href={cal.url}><span className="pill-link__tag">New</span>Memories Calendar 2027 is here <Icon name="arrow-right" /></a>}
            <h1 className="display" id="hero-title">Personalised photo gifts for every <span className="serif">kissa<svg className="squiggle" viewBox="0 0 220 24" preserveAspectRatio="none" aria-hidden="true"><path d="M4 15c28-9 56-11 84-5s58 9 88 2 26-5 40-5" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" /></svg></span>.</h1>
            <p className="lead">Every photo has a <em>kissa</em> - a story worth keeping. Turn yours into polaroid-style Memoroids, photo strips, song plaques, star maps and more, printed on premium card and delivered across India.</p>
            <div className="hero__ctas">
              <a className="btn btn--kiss" href="/shop/">Start creating <Icon name="arrow-right" className="icon--arrow" /></a>
              <a className="btn btn--ghost" href="/collections/bestsellers/">Shop bestsellers</a>
            </div>
            <div className="hero__proof">
              <div className="avatars">{["av-1", "av-2", "av-3", "av-4"].map((a) => <Img key={a} name={a} alt="" sizes="42px" w={42} h={42} eager />)}</div>
              <div><Stars rating={4.9} /><p><strong>{site.proof.rating}/5</strong> from {site.proof.customers} happy gifters</p></div>
            </div>
          </div>

          <div className="hero__art">
            <div className="mini-strip" aria-hidden="true">{["pola-holi", "pola-family", "pola-sunset"].map((s) => <Img key={s} name={s} alt="" sizes="90px" w={280} h={280} />)}</div>
            <figure className="polaroid p2"><Picture name="pola-friends" alt="Memoroid print of four friends laughing on a picnic" sizes="(min-width: 1024px) 210px, 36vw" /><figcaption>besties</figcaption></figure>
            <figure className="polaroid p1"><Picture name="pola-couple" alt="Classic Memoroid print of a smiling couple" sizes="(min-width: 1024px) 290px, 50vw" priority /><figcaption>us, always {heart}</figcaption></figure>
            <span className="tape" aria-hidden="true" />
            <figure className="polaroid p3"><Picture name="pola-pet" alt="Memoroid print of a golden retriever puppy" sizes="(min-width: 1024px) 190px, 33vw" /><figcaption>bruno</figcaption></figure>
            <div className="player" aria-hidden="true">
              <Img name="pola-sunset" alt="" sizes="64px" w={280} h={280} />
              <div><strong>Tum Se Hi</strong><span>Mohit Chauhan</span></div>
              <span className="player__btn"><Icon name="play" /></span>
              <span className="player__bar"><i /></span>
            </div>
            <div className="spin-badge" aria-hidden="true">
              <svg className="spin-badge__core" viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="#1b1414" /><path d="M60 74s-12-7.1-12-14.8c0-3.9 3-7 6.8-7 2.2 0 4.1 1.1 5.2 3 1.1-1.9 3-3 5.2-3 3.8 0 6.8 3.1 6.8 7C72 66.9 60 74 60 74z" fill="#d7263d" /></svg>
              <svg className="spin-badge__ring" viewBox="0 0 120 120"><defs><path id="badge-path" d="M60 60m-45 0a45 45 0 1 1 90 0a45 45 0 1 1-90 0" /></defs><text fill="#fff9f3" fontSize="10.5" fontWeight="700" letterSpacing="1.5"><textPath href="#badge-path" textLength="280" lengthAdjust="spacing">PRINTED WITH LOVE · MADE IN INDIA ·</textPath></text></svg>
            </div>
            <div className="price-sticker" aria-hidden="true"><small>prints from</small><b>₹149</b></div>
            <svg className="doodle doodle--1" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-sparkle" fill="currentColor" /></svg>
          </div>
        </div>
      </section>

      <div className="band-wrap" aria-hidden="true">
        <div className="band"><div className="band__track">
          {[0, 1].map((n) => (
            <ul key={n}>{["Memoroids", "photo strips", "Song plaques", "star maps", "Magazines", "calendars", "Keychains", "gift hampers"].map((w) => <li key={w}>{w}<svg viewBox="0 0 24 24"><use href="#i-sparkle" /></svg></li>)}</ul>
          ))}
        </div></div>
      </div>

      <section className="section" aria-labelledby="cats-title">
        <div className="wrap">
          <div className="section-head">
            <div className="section-head__text"><span className="eyebrow">Shop by category</span><h2 className="h2" id="cats-title">Pick a format, <span className="serif accent">we&apos;ll do the rest</span></h2></div>
            <a className="link-arrow" href="/shop/">Browse all gifts <Icon name="arrow-right" /></a>
          </div>
          <ul className="cats">
            {vis.groups(categories).map((c) => (
              <li key={c.slug}><a className="cat reveal" href={c.url}><span className="cat__img"><Picture name={c.image} alt="" sizes={CAT_SIZES} widths={[360, 640]} /></span><span className="cat__name">{c.name}</span><span className="cat__sub">{c.sub}</span></a></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section section--flush-top" aria-labelledby="best-title">
        <div className="wrap">
          <BestsellerTabs
            heading={<div className="section-head__text"><span className="eyebrow">Most loved</span><h2 className="h2" id="best-title">Bestselling keepsakes</h2></div>}
            tabs={[["top", "Bestsellers"], ["friends", "For friends"], ["parents", "For parents"], ["under-400", "Under ₹400"]]}
            items={productsByReviews.filter((p) => on(p.slug)).map((p) => ({ key: p.slug, tags: p.filterTags, node: <ProductCard p={p} /> }))}
          />
          <div className="more-row"><a className="btn btn--ghost" href="/collections/bestsellers/">View all bestsellers <Icon name="arrow-right" className="icon--arrow" /></a></div>
        </div>
      </section>

      <section className="section section--flush-top" aria-labelledby="how-title">
        <div className="wrap">
          <div className="section-head"><div className="section-head__text"><span className="eyebrow">How it works</span><h2 className="h2" id="how-title">From camera roll to keepsake in <span className="serif accent">three steps</span></h2></div></div>
          <ol className="steps">
            <li className="step reveal" style={tint("blush")}><div className="step__top"><span className="step__icon"><Icon name="gift" /></span><span className="step__num" data-num="01" aria-hidden="true" /></div><h3>Choose your keepsake</h3><p>Memoroids, plaques, magazines, frames and more - {products.length} ways to tell your story.</p></li>
            <li className="step reveal" style={tint("sky")}><div className="step__top"><span className="step__icon"><Icon name="upload" /></span><span className="step__num" data-num="02" aria-hidden="true" /></div><h3>Add your photos</h3><p>Upload from your phone in seconds, or send them to us after you order.</p></li>
            <li className="step reveal" style={tint("butter")}><div className="step__top"><span className="step__icon"><Icon name="package" /></span><span className="step__num" data-num="03" aria-hidden="true" /></div><h3>We print &amp; deliver</h3><p>Printed on premium card, packed gift-ready and dispatched within {site.dispatch}.</p></li>
          </ol>
        </div>
      </section>

      {on(memo.slug) && (
      <section className="section section--flush-top" aria-labelledby="maker-title">
        <div className="wrap">
          <div className="maker">
            <MemoroidMaker
              photos={[["pola-couple", "Couple"], ["pola-friends", "Friends"], ["pola-pet", "Puppy"], ["pola-holi", "Holi"], ["pola-family", "Family"]].map(([id, label]) => ({
                id, label, full: imageUrl(id, 560, "webp"), thumb: <Img name={id} alt="" sizes="62px" w={62} h={62} />,
              }))}
              styles={[["classic", "Classic", "#ffffff"], ["vintage", "Vintage", "#efe2c7"], ["noir", "Noir", "#161212"], ["blush", "Blush", "#ffd3d9"]]}
              uploadIcon={<Icon name="upload" />}
              buy={
                <div className="maker__buy">
                  <a className="btn btn--kiss" href={memo.url}>Order your Memoroids <Icon name="arrow-right" className="icon--arrow" /></a>
                  <div><strong>{inr(memo.price)}</strong><small>for a set of 10 · free shipping over {inr(site.free_shipping_over)}</small></div>
                </div>
              }
            />
          </div>
        </div>
      </section>
      )}

      <section className="section section--flush-top" aria-labelledby="occ-title">
        <div className="wrap">
          <div className="section-head">
            <div className="section-head__text"><span className="eyebrow">Shop by occasion</span><h2 className="h2" id="occ-title">A gift for every kind of <span className="serif accent">love</span></h2></div>
            <a className="link-arrow" href="/shop/">See all gifts <Icon name="arrow-right" /></a>
          </div>
          <div className="bento">
            {vis.groups(occasions).map((o, i) => (
              <a key={o.slug} className="occ reveal" href={o.url}><Picture name={o.image} alt="" sizes={i === 0 ? "(min-width: 900px) 50vw, 100vw" : "(min-width: 900px) 25vw, 50vw"} /><span className="occ__title">{o.name} <Icon name="arrow-right" /></span><span className="occ__sub">{o.sub}</span></a>
            ))}
          </div>
        </div>
      </section>

      {on(mag.slug) && (
      <section className="section section--flush-top" aria-labelledby="mag-title">
        <div className="wrap">
          <div className="spotlight">
            <div className="spotlight__media"><Picture name={mag.slug} alt="Personalised Kissa magazine with a wedding couple on the cover" sizes="(min-width: 1360px) 680px, (min-width: 900px) 50vw, 100vw" /></div>
            <div className="spotlight__body">
              <span className="eyebrow">Fan favourite</span>
              <h2 className="h2" id="mag-title">Make them the <span className="serif accent">cover star</span></h2>
              <p className="lead">Send us your photos and a few little stories. Our designers turn them into a real, glossy magazine - cover lines, features, inside jokes and all.</p>
              <ul className="checklist">
                <li><Icon name="check" />8 to 24 glossy A4 pages</li>
                <li><Icon name="check" />Designed for you, with a preview before we print</li>
                <li><Icon name="check" />Made for anniversaries, birthdays and weddings</li>
              </ul>
              <div className="spotlight__buy"><a className="btn" href={mag.url}>Create your magazine <Icon name="arrow-right" className="icon--arrow" /></a><strong>from {inr(mag.price)}</strong></div>
            </div>
          </div>
        </div>
      </section>
      )}

      <section className="section section--flush-top" aria-labelledby="rev-title">
        <div className="wrap">
          <div className="section-head">
            <div className="section-head__text"><span className="eyebrow">Real kissas</span><h2 className="h2" id="rev-title">Loved by gifters across India</h2></div>
            <div className="score-card">
              <span className="score">{site.proof.rating}</span>
              <div><Stars rating={4.9} /><p>from {site.proof.reviews} reviews</p></div>
              <CarouselButtons target="rev-list" prevIcon={<Icon name="arrow-left" />} nextIcon={<Icon name="arrow-right" />} />
            </div>
          </div>
          <ul className="carousel" id="rev-list">{reviews.filter((r) => on(r.product)).map((r) => <ReviewCard key={r.name} r={r} />)}</ul>
        </div>
      </section>

      <section className="section section--flush-top" aria-labelledby="ugc-title">
        <div className="wrap">
          <div className="section-head">
            <div className="section-head__text"><span className="eyebrow">#MyKissa</span><h2 className="h2" id="ugc-title">Spotted on your walls</h2><p className="lead">Tag <strong>@kissaprints</strong> on Instagram for a chance to be featured - and a little surprise in your next order.</p></div>
          </div>
          <div className="ugc">
            {[["ugc-wall", "A wooden wall covered with printed photos and a lamp"], ["ugc-instax", "Instant photo prints scattered on a white sheet"],
              ["ugc-yellow", "Hands holding a fresh print next to a yellow instant camera"], ["ugc-hand", "A hand holding a polaroid print over a pile of photos"]].map(([u, alt], i) => (
              <a key={u} className="ugc__photo reveal" href={site.social.instagram} target="_blank" rel="noopener"><Picture name={u} alt={`${alt} - view on Instagram`} sizes={i === 0 ? "(min-width: 768px) 50vw, 100vw" : "(min-width: 768px) 25vw, 50vw"} /><Icon name="instagram" /></a>
            ))}
            <a className="ugc__cta reveal" href={site.social.instagram} target="_blank" rel="noopener"><Icon name="instagram" /><span><strong>Follow @kissaprints</strong><span>New drops, behind the scenes and giveaways</span></span></a>
          </div>
        </div>
      </section>

      <section className="section section--flush-top" aria-labelledby="fest-title">
        <div className="wrap">
          <div className="festive">
            <Picture name="festive-diyas" alt="" sizes="(min-width: 1360px) 1320px, 100vw" />
            <div className="festive__body">
              <span className="eyebrow">Diwali · Christmas · New Year</span>
              <h2 className="h2" id="fest-title">Festive gifting, <span className="serif">sorted.</span></h2>
              <p>Personalised hampers with Memoroids, magnets, keychains and a handwritten note - wrapped, ribboned and ready to give. Order early for festive delivery.</p>
              <div className="festive__ctas">{vis.url("/collections/hampers/") && <a className="btn btn--light" href="/collections/hampers/">Shop gift hampers</a>}<a className="btn btn--ghost" href="/bulk-orders/">Bulk &amp; corporate orders</a></div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--flush-top" aria-label="Why KissaPrints">
        <div className="wrap">
          <ul className="usps">
            <li className="usp" style={tint("blush")}><span className="usp__icon"><Icon name="sparkle" /></span><div><h3>Premium prints</h3><p>Thick 300 GSM card with rich, fade-resistant colour.</p></div></li>
            <li className="usp" style={tint("sky")}><span className="usp__icon"><Icon name="truck" /></span><div><h3>Ships in {site.dispatch}</h3><p>Tracked delivery across India in {site.delivery}.</p></div></li>
            <li className="usp" style={tint("butter")}><span className="usp__icon"><Icon name="gift" /></span><div><h3>Gift-ready packing</h3><p>Wrapped with care, every single time.</p></div></li>
            <li className="usp" style={tint("mint")}><span className="usp__icon"><Icon name="shield" /></span><div><h3>Secure payments</h3><p>UPI, cards and net banking, fully encrypted.</p></div></li>
          </ul>
        </div>
      </section>

      <section className="section section--flush-top" aria-labelledby="faq-title">
        <div className="wrap faq">
          <div className="faq__aside">
            <span className="eyebrow">FAQ</span>
            <h2 className="h2" id="faq-title">Questions? <span className="serif accent">Answered.</span></h2>
            <div className="help-card"><strong>Still unsure about something?</strong><p>We&apos;re here {site.hours}. Call <PhoneLinks />.</p><a className="btn btn--ghost btn--sm" href="/contact/">Contact us</a></div>
          </div>
          <div className="accordion">
            {faqs.map((f, i) => <details key={f.q} open={i === 0}><summary>{f.q}<span className="plus" aria-hidden="true" /></summary><div className="answer"><p>{f.a}</p></div></details>)}
          </div>
        </div>
      </section>

      <section className="section section--flush-top" aria-labelledby="club-title">
        <div className="wrap">
          <div className="club">
            <div>
              <span className="eyebrow">The Kissa Club</span>
              <h2 className="h2" id="club-title">Get ₹100 off your first order</h2>
              <p>Plus early access to new drops, festive offers and the occasional sweet surprise. No spam, ever.</p>
            </div>
            <div>
              <DemoForm className="club__form" done="You're in! Check your inbox for your ₹100 welcome code.">
                <label className="sr-only" htmlFor="club-email">Email address</label>
                <input id="club-email" type="email" name="email" placeholder="you@example.com" autoComplete="email" required />
                <button className="btn btn--kiss" type="submit">Join the club</button>
              </DemoForm>
              <small>By joining you agree to our <a href="/privacy/">privacy policy</a>. Unsubscribe anytime.</small>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
