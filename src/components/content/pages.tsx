// Info pages (about, contact, policies...). Titles and descriptions as on the original site; body copy marked
// "draft" still needs your real details / a legal review before launch.
import { categories, faqs, site } from "@/lib/catalog";
import { inr } from "@/lib/format";
import { ldBreadcrumbs } from "@/lib/seo";
import { shopVisibility } from "@/lib/server/visibility";
import { DemoForm } from "../shop/bits";
import { PhoneLinks } from "../shop/chrome";
import { Breadcrumbs, Icon, JsonLd, Picture } from "../ui";

const tint = (t: string) => ({ "--tint": `var(--${t})` }) as React.CSSProperties;

export type InfoMeta = { title: string; heading: string; intro: string; description: string; noindex?: boolean };
export type InfoPage = InfoMeta & { body: () => React.ReactNode | Promise<React.ReactNode> };

function About() {
  return (
    <>
      <div className="page-banner" style={{ aspectRatio: "16 / 7" }}><Picture name="about-friends" alt="Friends celebrating Holi together, covered in colour" sizes="(min-width: 1360px) 1320px, 100vw" priority /></div>
      <div className="page-layout" style={{ marginTop: "clamp(32px, 5vw, 56px)" }}>
        <div className="prose">
          <h2>Why we started KissaPrints</h2>
          <p>Our phones hold thousands of photos, yet the moments that matter most rarely leave the camera roll. KissaPrints began with a simple idea: every photo has a <em>kissa</em> - a story - and stories deserve to be held, gifted and kept.</p>
          <p>We design and print personalised keepsakes in India, from polaroid-style Memoroids to song plaques, star maps and magazines. We obsess over the details that make a gift feel personal: thick card, honest colour, careful packing and a real person checking every order.</p>
          <h2>How we work</h2>
          <ul>
            <li><strong>Human-checked.</strong> Every photo is reviewed before printing, so blurry or dark shots get flagged - not printed.</li>
            <li><strong>Printed with care.</strong> Premium papers, rich inks and hand-finishing on every piece.</li>
            <li><strong>Packed to be gifted.</strong> Every order leaves our studio ready to hand over.</li>
          </ul>
          <p className="note">Draft copy - add your founder story, team photo and studio details before launch.</p>
        </div>
        <aside className="aside-card">
          <h2>Say hello</h2>
          <p>We love hearing your kissas, and your ideas for what we should make next.</p>
          <a className="btn" href="/contact/">Contact us</a>
          <a className="btn btn--ghost" href="/bulk-orders/">Bulk &amp; corporate orders</a>
        </aside>
      </div>
      <div className="values" style={{ marginTop: "clamp(40px, 6vw, 72px)" }}>
        <div className="value" style={tint("blush")}><h3>Made in India</h3><p>Designed, printed and packed in our own studio.</p></div>
        <div className="value" style={tint("sky")}><h3>Real support</h3><p>Talk to real people on the phone or by email, {site.hours}.</p></div>
        <div className="value" style={tint("butter")}><h3>Reprint promise</h3><p>Damaged or misprinted? We&apos;ll reprint it, free.</p></div>
      </div>
    </>
  );
}

function Contact() {
  return (
    <div className="page-layout">
      <DemoForm className="form" done="Thanks! We've got your message and will reply within a few hours.">
        <div className="form-row">
          <label>Your name<input className="input" name="name" autoComplete="name" required /></label>
          <label>Email<input className="input" type="email" name="email" autoComplete="email" required /></label>
        </div>
        <div className="form-row">
          <label>Phone (optional)<input className="input" type="tel" name="phone" autoComplete="tel" inputMode="tel" /></label>
          <label>Order number (optional)<input className="input" name="order" placeholder="KP-12345" /></label>
        </div>
        <label>What&apos;s it about?
          <select className="input select" name="topic" defaultValue="A question before ordering">
            <option>A question before ordering</option><option>My order</option><option>Bulk or corporate order</option><option>Something else</option>
          </select>
        </label>
        <label>Message<textarea className="input" name="message" rows={5} required /></label>
        <div><button className="btn btn--kiss" type="submit">Send message <Icon name="arrow-right" className="icon--arrow" /></button></div>
      </DemoForm>
      <aside className="aside-card">
        <h2>Other ways to reach us</h2>
        <p className="contact-line"><Icon name="phone" /><span><PhoneLinks /></span></p>
        <p className="contact-line"><Icon name="clock" /><span>Support {site.hours}</span></p>
        <p className="contact-line"><Icon name="mail" /><a href={`mailto:${site.email}`}>{site.email}</a></p>
        <p className="contact-line"><Icon name="instagram" /><a href={site.social.instagram} target="_blank" rel="noopener">@kissaprints on Instagram</a></p>
        <p className="note">Add your registered business address here before launch.</p>
      </aside>
    </div>
  );
}

function Faq() {
  return (
    <div className="page-layout">
      <div className="accordion">
        {faqs.map((f, i) => <details key={f.q} open={i === 0}><summary>{f.q}<span className="plus" aria-hidden="true" /></summary><div className="answer"><p>{f.a}</p></div></details>)}
      </div>
      <aside className="aside-card">
        <h2>Didn&apos;t find your answer?</h2>
        <p>Call us any time, {site.hours}: <PhoneLinks />. Or send us a message and we&apos;ll reply within a few hours.</p>
        <a className="btn" href="/contact/">Contact us</a>
      </aside>
    </div>
  );
}

// Links and choices skip categories whose products are all switched off in /admin/products/.
async function BulkOrders() {
  const vis = await shopVisibility();
  return (
    <>
      <div className="values">
        <div className="value" style={tint("blush")}><h3>From 25 units</h3><p>Weddings, birthdays, offsites, Diwali gifting and client hampers.</p></div>
        <div className="value" style={tint("sky")}><h3>Your branding</h3><p>Custom packaging, logo printing and personalised notes for every recipient.</p></div>
        <div className="value" style={tint("butter")}><h3>Quote in 24 hours</h3><p>Tell us what you need - we&apos;ll reply with options, pricing and timelines.</p></div>
      </div>
      <div className="page-layout" style={{ marginTop: "clamp(32px, 5vw, 56px)" }}>
        <DemoForm className="form" done="Thanks! Our gifting team will send you a quote within one working day.">
          <div className="form-row">
            <label>Your name<input className="input" name="name" autoComplete="name" required /></label>
            <label>Company or event<input className="input" name="company" autoComplete="organization" /></label>
          </div>
          <div className="form-row">
            <label>Work email<input className="input" type="email" name="email" autoComplete="email" required /></label>
            <label>Phone<input className="input" type="tel" name="phone" autoComplete="tel" inputMode="tel" required /></label>
          </div>
          <div className="form-row">
            <label>Products you&apos;re interested in
              <select className="input select" name="product">{vis.groups(categories).map((c) => <option key={c.slug}>{c.name}</option>)}<option>Not sure yet</option></select>
            </label>
            <label>Quantity<input className="input" type="number" name="qty" min={25} defaultValue={50} inputMode="numeric" /></label>
          </div>
          <label>Needed by<input className="input" type="date" name="date" /></label>
          <label>Tell us more<textarea className="input" name="message" rows={4} placeholder="Occasion, budget per gift, branding ideas…" /></label>
          <div><button className="btn btn--kiss" type="submit">Request a quote <Icon name="arrow-right" className="icon--arrow" /></button></div>
        </DemoForm>
        <aside className="aside-card">
          <h2>Popular for teams</h2>
          <p>Engraved keychains, desk calendars, fridge magnets and our Affection Box hampers.</p>
          {vis.url("/collections/hampers/") && <a className="btn btn--ghost" href="/collections/hampers/">See gift hampers</a>}
          <p>Prefer email? Write to <a href={`mailto:${site.email}`}>{site.email}</a> with your requirement.</p>
        </aside>
      </div>
    </>
  );
}

const Policy = ({ children, aside }: { children: React.ReactNode; aside: React.ReactNode }) => (
  <div className="page-layout"><div className="prose">{children}</div><aside className="aside-card">{aside}</aside></div>
);

function Shipping() {
  return (
    <Policy aside={<><h2>Where&apos;s my order?</h2><p>Use your order number to check its status.</p><a className="btn" href="/track-order/">Track your order</a></>}>
      <p className="note">Draft policy - confirm dispatch times, courier partners and charges before launch.</p>
      <h2>Dispatch</h2>
      <p>Every order is checked by our team, printed and dispatched within <strong>{site.dispatch}</strong> (Monday to Saturday). Designed products such as magazines, newspapers and calendars are dispatched within 48 hours of you approving the digital preview.</p>
      <h2>Delivery time</h2>
      <p>Most orders reach metro cities in 3-5 working days and the rest of India in {site.delivery}. You&apos;ll receive a tracking link by SMS and email as soon as your parcel ships.</p>
      <h2>Shipping charges</h2>
      <ul>
        <li>Free shipping on orders above {inr(site.free_shipping_over)}.</li>
        <li>A flat {inr(site.shipping_fee)} shipping fee applies to smaller orders and is shown at checkout.</li>
      </ul>
      <h2>Festive and urgent orders</h2>
      <p>During festive weeks courier networks get busy, so please order early. Need something by a specific date? <a href="/contact/">Message us</a> before ordering and we&apos;ll tell you honestly whether we can make it.</p>
    </Policy>
  );
}

function Returns() {
  return (
    <Policy aside={<><h2>Something not right?</h2><p>Tell us what happened - we&apos;ll make it right.</p><a className="btn" href="/contact/">Report an issue</a></>}>
      <p className="note">Draft policy - review with your team before launch.</p>
      <h2>Personalised means made for you</h2>
      <p>Because every KissaPrints product is printed with your photos and words, we can&apos;t accept returns or exchanges for change of mind. We do, however, stand behind every single print.</p>
      <h2>Our reprint promise</h2>
      <p>If your order arrives damaged, misprinted or with something missing, send us a photo of the product and packaging within <strong>48 hours of delivery</strong>. We&apos;ll reprint and reship it free of charge, or refund you if a reprint isn&apos;t possible.</p>
      <h2>Cancellations</h2>
      <p>You can cancel for a full refund until your order goes to print - usually within a few hours of ordering. Once printing has started we can&apos;t cancel the order.</p>
      <h2>Refund timelines</h2>
      <p>Approved refunds go back to your original payment method within 5-7 working days.</p>
    </Policy>
  );
}

function Privacy() {
  return (
    <Policy aside={<><h2>Questions about privacy?</h2><p>Write to us and we&apos;ll reply within two working days.</p><a className="btn btn--ghost" href={`mailto:${site.email}`}>Email us</a></>}>
      <p className="note">Draft for design purposes only - have this reviewed by a legal professional (including for India&apos;s Digital Personal Data Protection Act, 2023) before launch.</p>
      <h2>What we collect</h2>
      <p>When you order, we collect your name, contact details, delivery address and the photos and text you send us to personalise your products. If you create an account we also keep your email and a securely hashed password. Payments are handled by our payment partner; we never see or store your full card details.</p>
      <h2>How we use it</h2>
      <ul>
        <li>To print, pack and deliver your order and keep you updated about it.</li>
        <li>To help you with questions, reprints and refunds.</li>
        <li>To send offers, only if you&apos;ve joined the Kissa Club. You can unsubscribe anytime.</li>
      </ul>
      <h2>Your photos</h2>
      <p>Your photos are used only to make your order. We delete them from our systems within 30 days of delivery unless you ask us to keep them for a re-order. We never share or publish customer photos without permission.</p>
      <h2>Your choices</h2>
      <p>You can ask us to access, correct or delete your personal data at any time by writing to <a href={`mailto:${site.email}`}>{site.email}</a>.</p>
    </Policy>
  );
}

function Terms() {
  return (
    <Policy aside={<><h2>Need help?</h2><p>We&apos;re happy to explain anything here in plain words.</p><a className="btn btn--ghost" href="/contact/">Contact us</a></>}>
      <p className="note">Draft for design purposes only - have this reviewed by a legal professional before launch.</p>
      <h2>Using this website</h2>
      <p>By using kissaprints.com and placing an order, you agree to these terms. Prices are in Indian Rupees and include applicable taxes unless stated otherwise.</p>
      <h2>Your content</h2>
      <p>You confirm that you own, or have permission to use, every photo and piece of text you send us, and that it doesn&apos;t infringe anyone&apos;s rights. We may refuse to print content that is unlawful, hateful or infringes intellectual property.</p>
      <h2>Colours and previews</h2>
      <p>Screens display colour differently, so printed colours can vary slightly from what you see on your device. Previews for designed products are representative of the final layout.</p>
      <h2>Orders</h2>
      <p>An order is confirmed once payment succeeds. See our <a href="/shipping/">shipping</a> and <a href="/returns/">returns &amp; reprints</a> policies for delivery, cancellation and refund details.</p>
    </Policy>
  );
}

async function ThankYou() {
  const vis = await shopVisibility();
  const links: [string, string][] = [["Shop bestsellers", "/collections/bestsellers/"], ["Memoroids", "/collections/memoroids/"], ["Gifts for couples", "/gifts/for-couples/"]];
  return (
    <div className="page-layout">
      <div className="prose">
        <p>We&apos;ve got it. Keep an eye on your inbox - and while you wait, here are a few places to start.</p>
        <p>{links.filter(([, url]) => vis.url(url)).map(([label, url], i) => <span key={url}>{i > 0 && " · "}<a href={url}>{label}</a></span>)}</p>
      </div>
    </div>
  );
}

export const INFO_PAGES: Record<string, InfoPage> = {
  about: { title: "Our Story | KissaPrints", heading: "Every photo has a *kissa*.", body: About,
    intro: "We're a small team in India turning camera-roll moments into keepsakes you can hold, gift and keep.",
    description: "The story behind KissaPrints - personalised photo gifts designed, printed and packed with care in India." },
  contact: { title: "Contact Us | KissaPrints", heading: "Talk to a real *human*", body: Contact,
    intro: "Questions about an order, a custom idea or bulk gifting? We usually reply within a few hours.",
    description: "Contact KissaPrints for help with orders, custom personalised gifts and bulk orders." },
  faq: { title: "FAQs - Orders, Photos & Delivery | KissaPrints", heading: "Frequently asked *questions*", body: Faq,
    intro: "Everything about sending photos, previews, delivery, payments and our reprint promise.",
    description: "Answers to common questions about KissaPrints orders, photo uploads, print quality, delivery and payments." },
  "bulk-orders": { title: "Bulk & Corporate Gifting | KissaPrints", heading: "Bulk & corporate *gifting*", body: BulkOrders,
    intro: "Personalised gifts for weddings, events and teams - from 25 units, with your branding.",
    description: "Personalised bulk and corporate gifts from KissaPrints - hampers, keychains, calendars and more from 25 units." },
  shipping: { title: "Shipping & Delivery | KissaPrints", heading: "Shipping & delivery", body: Shipping,
    intro: "How quickly we dispatch, where we deliver and what shipping costs.",
    description: "KissaPrints shipping policy: dispatch within 48 hours and delivery across India in 5-7 working days." },
  returns: { title: "Returns & Reprints | KissaPrints", heading: "Returns & reprints", body: Returns,
    intro: "Personalised gifts can't be returned for change of mind - but we'll always make things right.",
    description: "KissaPrints returns, cancellations and reprint promise for damaged or misprinted personalised gifts." },
  privacy: { title: "Privacy Policy | KissaPrints", heading: "Privacy policy", body: Privacy,
    intro: "How we collect, use and protect your information and photos.",
    description: "How KissaPrints collects, uses and protects your personal information and photos." },
  terms: { title: "Terms of Service | KissaPrints", heading: "Terms of service", body: Terms,
    intro: "The terms that apply when you use KissaPrints.",
    description: "Terms of service for using kissaprints.com and ordering personalised photo gifts." },
  "thank-you": { title: "Thank You | KissaPrints", heading: "Thank you!", body: ThankYou, intro: "", noindex: true,
    description: "Thanks for getting in touch with KissaPrints." },
};

/** Breadcrumbs, heading and intro above an info page's body (app/(shop)/[page] and app/(shop)/track-order). */
export function InfoView({ slug, info, ld = [], children }: { slug: string; info: InfoMeta; ld?: object[]; children: React.ReactNode }) {
  const crumbs: [string, string][] = [["Home", "/"], [info.title.split(" | ")[0].split(" - ")[0], `/${slug}/`]];
  return (
    <div className="wrap">
      <JsonLd data={[ldBreadcrumbs(crumbs), ...ld]} />
      <header className="page-hero">
        <Breadcrumbs items={crumbs} />
        <h1><Emph text={info.heading} /></h1>
        {info.intro && <p className="lead">{info.intro}</p>}
      </header>
      {children}
    </div>
  );
}

/** "Every photo has a *kissa*." -> the starred word in the brand's italic serif. */
export function Emph({ text }: { text: string }) {
  return <>{text.split(/\*(.+?)\*/).map((part, i) => (i % 2 ? <span key={i} className="serif accent">{part}</span> : part))}</>;
}
