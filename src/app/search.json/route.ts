// The small index the header search box loads on first use. A static file at build time, re-made when a product is
// switched on or off in /admin/products/ (hidden products never show up in search).
import { image, imageUrl } from "@/lib/assets";
import { products } from "@/lib/catalog";
import { hiddenProducts } from "@/lib/server/visibility";

export const dynamic = "force-static";

export async function GET() {
  const hidden = await hiddenProducts();
  return Response.json(products.filter((p) => !hidden.has(p.slug)).map((p) => ({
    name: p.name, url: p.url, meta: p.meta, price: p.price,
    image: imageUrl(p.slug, image(p.slug).widths.includes(120) ? 120 : image(p.slug).widths[0], "webp"),
    text: [p.name, p.categoryName, p.meta, p.short, ...p.tags].join(" ").toLowerCase(),
  })));
}
