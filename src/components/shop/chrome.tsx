// Header, footer and dialog shells (server components). Interactive bits are small client components from ./bits.
import { categories, NAV_GROUPS, occasions, productsBySlug, site } from "@/lib/catalog";
import { inr, phoneDisplay, telHref } from "@/lib/format";
import { shopVisibility } from "@/lib/server/visibility";
import { Icon, Img, LogoLink } from "../ui";
import { CartButton, HeaderShell, MegaItem, OpenButton, Toast } from "./bits";
import { CartDrawer, SearchDialog } from "./dialogs";
import { ShopDialog } from "./provider";

export function PhoneLinks({ sep = " or " }: { sep?: string }) {
  return <>{site.support_phones.map((n, i) => <span key={n}>{i > 0 && sep}<a href={telHref(n)}>{phoneDisplay(n)}</a></span>)}</>;
}

export async function Header() {
  const offers = [
    `Free shipping on orders above ${inr(site.free_shipping_over)}`,
    "Festive gifting is live - gift-ready packing on every order",
    `Printed in India · dispatched in ${site.dispatch}`,
    "Pay securely with UPI, cards & net banking",
    `24/7 support: ${phoneDisplay(site.support_phones[0])}`,
  ];
  // Switched-off products (/admin/products/) and the categories/occasions they empty never show up in the menus.
  const vis = await shopVisibility();
  const feat = productsBySlug["memories-calendar-2027"];
  const showFeat = vis.product(feat.slug);
  return (
    <>
      <div className="announce">
        <div className="announce__track">
          <ul className="announce__list">{offers.map((o) => <li key={o}>{o}</li>)}</ul>
          <ul className="announce__list" aria-hidden="true">{offers.map((o) => <li key={o}>{o}</li>)}</ul>
        </div>
      </div>
      <HeaderShell>
        <div className="wrap header__bar">
          <OpenButton dialog="menu-drawer" className="icon-btn menu-btn" label="Open menu"><Icon name="menu" /></OpenButton>
          <LogoLink />
          <nav className="nav" aria-label="Main">
            <ul className="nav__list">
              <MegaItem label={<>Shop <Icon name="chevron-down" /></>} panelId="mega-shop">
                <div className="mega" id="mega-shop">
                  <div className="wrap mega__inner">
                    {NAV_GROUPS.map((g) => ({ ...g, links: vis.groups(g.links) })).filter((g) => g.links.length).map((group) => (
                      <div key={group.title}>
                        <p className="mega__title">{group.title}</p>
                        <ul className="mega__links">
                          {group.links.map((c) => (
                            <li key={c.slug}><a href={c.url}><Img name={c.image} alt="" sizes="46px" w={46} h={46} /><span>{c.name}<small>{c.sub}</small></span></a></li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {showFeat && <a className="mega__feature" href={feat.url}>
                      <Img name={feat.slug} alt="" sizes="120px" w={120} h={120} />
                      <div><span className="badge badge--new">New</span><strong>{feat.name}</strong><span>12 months of your favourite photos, from {inr(feat.price)}.</span></div>
                    </a>}
                  </div>
                </div>
              </MegaItem>
              <MegaItem label={<>Gifts for <Icon name="chevron-down" /></>} panelId="mega-gifts">
                <div className="mega" id="mega-gifts">
                  <div className="wrap mega__occ">
                    {vis.groups(occasions).map((o) => (
                      <a key={o.slug} className="mega__tile" href={o.url}><Img name={o.image} alt="" sizes="(min-width: 1360px) 250px, 18vw" /><strong>{o.name}</strong><span>{o.sub}</span></a>
                    ))}
                  </div>
                </div>
              </MegaItem>
              {vis.url("/collections/memoroids/") && <li className="nav__item"><a className="nav__link" href="/collections/memoroids/">Memoroids</a></li>}
              <li className="nav__item"><a className="nav__link" href="/collections/bestsellers/">Bestsellers</a></li>
              <li className="nav__item"><a className="nav__link" href="/bulk-orders/">Bulk orders</a></li>
            </ul>
          </nav>
          <div className="header__actions">
            <OpenButton dialog="search-dialog" className="icon-btn" label="Search"><Icon name="search" /></OpenButton>
            <a className="icon-btn hide-mobile" href="/track-order/" aria-label="Track your order"><Icon name="package" /></a>
            <a className="icon-btn hide-mobile" href="/account/" aria-label="Your account"><Icon name="user" /></a>
            <CartButton><Icon name="bag" /></CartButton>
          </div>
        </div>
      </HeaderShell>
    </>
  );
}

const POPULAR: [string, string][] = [
  ["Personalised gifts for girlfriend", "/gifts/for-her/"], ["Anniversary gifts for couples", "/gifts/for-couples/"],
  ["Custom polaroid prints", "/collections/memoroids/"], ["Song plaque with photo", "/collections/song-plaques/"],
  ["Star map gift", "/collections/star-maps/"], ["Customised magazine", "/collections/magazines/"],
  ["Photo booth strips", "/collections/photo-strips/"], ["Photo calendar 2027", "/collections/calendars/"],
  ["Gifts for best friend", "/gifts/for-friends/"], ["Gifts for parents", "/gifts/for-parents/"],
  ["Photo keychain", "/collections/keychains/"], ["Photo fridge magnets", "/collections/fridge-magnets/"],
  ["Diwali gift hampers", "/collections/hampers/"], ["Corporate gifting", "/bulk-orders/"],
];

export async function Footer() {
  const vis = await shopVisibility();
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer__top">
          <div className="footer__brand">
            <LogoLink />
            <p>{site.tagline} Personalised photo gifts, printed with love in India and delivered to your door.</p>
            <div className="footer__support">
              <p className="footer__support-title"><Icon name="phone" /><strong>Support 24/7</strong><span>· every day of the week</span></p>
              <p><PhoneLinks sep=" · " /></p>
            </div>
            <ul className="socials">
              <li><a href={site.social.instagram} target="_blank" rel="noopener" aria-label="KissaPrints on Instagram"><Icon name="instagram" /></a></li>
              <li><a href={site.social.youtube} target="_blank" rel="noopener" aria-label="KissaPrints on YouTube"><Icon name="youtube" /></a></li>
              <li><a href={site.social.facebook} target="_blank" rel="noopener" aria-label="KissaPrints on Facebook"><Icon name="facebook" /></a></li>
              <li><a href={`mailto:${site.email}`} aria-label="Email KissaPrints"><Icon name="mail" /></a></li>
            </ul>
          </div>
          <div className="footer__col">
            <h2>Shop</h2>
            <ul>{vis.groups(categories).slice(0, 7).map((c) => <li key={c.slug}><a href={c.url}>{c.name}</a></li>)}<li><a href="/shop/">All gifts</a></li></ul>
          </div>
          <div className="footer__col">
            <h2>Gifts for</h2>
            <ul>
              {vis.groups(occasions).map((o) => <li key={o.slug}><a href={o.url}>{o.name.replace("For ", "")}</a></li>)}
              {vis.url("/collections/hampers/") && <li><a href="/collections/hampers/">Gift hampers</a></li>}<li><a href="/bulk-orders/">Bulk &amp; corporate</a></li>
            </ul>
          </div>
          <div className="footer__col">
            <h2>Help</h2>
            <ul><li><a href="/track-order/">Track your order</a></li><li><a href="/shipping/">Shipping &amp; delivery</a></li><li><a href="/returns/">Returns &amp; reprints</a></li><li><a href="/faq/">FAQs</a></li><li><a href="/contact/">Contact us</a></li></ul>
          </div>
          <div className="footer__col">
            <h2>Company</h2>
            <ul><li><a href="/about/">Our story</a></li><li><a href="/account/">Your account</a></li><li><a href="/bulk-orders/">Bulk orders</a></li><li><a href="/privacy/">Privacy policy</a></li><li><a href="/terms/">Terms of service</a></li></ul>
          </div>
        </div>
        <div className="footer__seo">
          <h2>Personalised gifts, made in India</h2>
          <p>KissaPrints turns your photos into personalised gifts: polaroid-style Memoroids, photo booth strips, song plaques with scannable codes, custom star maps, personalised magazines and newspapers, 2027 photo calendars, acrylic fridge magnets, engraved photo keychains, wooden photo frames and ready-to-gift hampers. Every order is printed on premium paper, packed gift-ready and delivered across India - Delhi, Mumbai, Bengaluru, Pune, Hyderabad, Chennai, Jaipur, Kolkata and beyond.</p>
          <ul className="chips">{POPULAR.filter(([, url]) => vis.url(url)).map(([label, url]) => <li key={label}><a className="chip-link" href={url}>{label}</a></li>)}</ul>
        </div>
        <div className="footer__bottom">
          <p>© {new Date().getFullYear()} KissaPrints. Made with love in India.</p>
          <ul className="pay" aria-label="Payment methods we accept"><li>UPI</li><li>VISA</li><li>Mastercard</li><li>RuPay</li><li>Net banking</li></ul>
        </div>
      </div>
      <p className="footer__giant" aria-hidden="true" />
    </footer>
  );
}

/** Search, cart and mobile-menu dialogs plus the toast - rendered once in the shop layout. */
export async function ShopDialogs() {
  const vis = await shopVisibility();
  const close = <Icon name="close" />;
  return (
    <>
      <SearchDialog searchIcon={<Icon name="search" />} closeIcon={close} suggestions={
        <>
          <h3>Popular right now</h3>
          <ul className="chips">{vis.groups(categories).slice(0, 8).map((c) => <li key={c.slug}><a className="chip-link" href={c.url}>{c.name}</a></li>)}</ul>
        </>
      } />
      <CartDrawer closeIcon={close} arrowIcon={<Icon name="arrow-right" className="icon--arrow" />} emptyState={
        <div className="cart-empty"><Icon name="heart" /><h3 className="h3">Your cart is waiting for a story</h3>
          <p className="muted">Start with our bestsellers - most orders ship within {site.dispatch}.</p>
          <a className="btn btn--sm" href="/collections/bestsellers/">Shop bestsellers</a></div>
      } />
      <ShopDialog id="menu-drawer" className="drawer drawer--left" label="Menu">
        <div className="drawer__panel">
          <div className="drawer__head"><LogoLink /><button className="icon-btn" type="button" aria-label="Close menu" data-close>{close}</button></div>
          <nav className="drawer__body" aria-label="Mobile">
            <ul className="mnav__list">
              <li><details open><summary>Shop by category <Icon name="chevron-down" /></summary>
                <ul className="mnav__cats">{vis.groups(categories).map((c) => <li key={c.slug}><a href={c.url}><Img name={c.image} alt="" sizes="30vw" w={120} h={120} max={130} />{c.name}</a></li>)}</ul>
              </details></li>
              <li><details><summary>Gifts for <Icon name="chevron-down" /></summary>
                <ul>{vis.groups(occasions).map((o) => <li key={o.slug}><a href={o.url}>{o.name}<Icon name="arrow-right" /></a></li>)}</ul>
              </details></li>
              <li><a href="/collections/bestsellers/">Bestsellers <Icon name="arrow-right" /></a></li>
              {vis.url("/collections/hampers/") && <li><a href="/collections/hampers/">Gift hampers <Icon name="arrow-right" /></a></li>}
              <li><a href="/bulk-orders/">Bulk orders <Icon name="arrow-right" /></a></li>
              <li><a href="/track-order/">Track your order <Icon name="arrow-right" /></a></li>
              <li><a href="/account/">Your account <Icon name="arrow-right" /></a></li>
              <li><a href="/about/">Our story <Icon name="arrow-right" /></a></li>
            </ul>
            <div className="mnav__foot">
              <a className="btn btn--kiss" href="/shop/">Start creating <Icon name="arrow-right" className="icon--arrow" /></a>
              <a className="btn btn--ghost" href="/contact/">Talk to us</a>
              <p className="mnav__call"><Icon name="phone" /><span>24/7 support: <PhoneLinks /></span></p>
            </div>
          </nav>
        </div>
      </ShopDialog>
      <Toast><Icon name="check" /></Toast>
    </>
  );
}

export function MinimalHeader({ secure = true }: { secure?: boolean }) {
  return (
    <header className="co-header">
      <div className="wrap co-header__bar">
        <LogoLink />
        {secure && <span className="secure-badge"><Icon name="shield" /> Secure checkout</span>}
      </div>
    </header>
  );
}

export function MinimalFooter() {
  return (
    <footer className="co-footer">
      <div className="wrap co-footer__bar">
        <p>© {new Date().getFullYear()} KissaPrints · Need help? Call us 24/7: <PhoneLinks /></p>
        <ul>
          <li><a href="/shipping/">Shipping</a></li>
          <li><a href="/returns/">Returns &amp; reprints</a></li>
          <li><a href="/privacy/">Privacy</a></li>
          <li><a href="/terms/">Terms</a></li>
        </ul>
      </div>
    </footer>
  );
}
