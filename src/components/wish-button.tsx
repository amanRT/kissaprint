"use client";
import { useShop } from "./shop/provider";

export function WishButton({ slug, name }: { slug: string; name: string }) {
  const { wish, toggleWish, say } = useShop();
  return (
    <button className="wish" type="button" aria-pressed={wish.has(slug)} aria-label={`Save ${name} to wishlist`} data-wish={slug}
      onClick={() => say(toggleWish(slug) ? "Saved to your wishlist" : "Removed from your wishlist")}>
      <svg className="icon" aria-hidden="true" focusable="false"><use href="#i-heart" /></svg>
    </button>
  );
}
