import { categories } from "@/lib/catalog";
import { shopVisibility } from "@/lib/server/visibility";
import { Icon } from "../ui";

/** The 404 message. app/not-found.tsx wraps it in the light header/footer; app/(shop)/not-found.tsx shows it inside the shop layout. */
export async function NotFoundBody() {
  const vis = await shopVisibility(); // no chips to categories that are switched off / empty
  return (
    <div className="wrap notfound">
      <figure className="polaroid"><div className="blank" aria-hidden="true">404</div><figcaption>this page went missing</figcaption></figure>
      <h1>This page wandered off.</h1>
      <p>Like that one photo you swear you took but can&apos;t find. Let&apos;s get you somewhere lovely instead.</p>
      <div className="hero__ctas" style={{ justifyContent: "center", marginTop: 8 }}>
        <a className="btn btn--kiss" href="/">Back to home <Icon name="arrow-right" className="icon--arrow" /></a>
        <a className="btn btn--ghost" href="/shop/">Shop all gifts</a>
      </div>
      <ul className="chips" aria-label="Popular gifts">
        {vis.groups(categories).slice(0, 8).map((c) => <li key={c.slug}><a className="chip-link" href={c.url}>{c.name}</a></li>)}
      </ul>
    </div>
  );
}
