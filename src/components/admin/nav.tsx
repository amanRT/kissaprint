/** Orders | Products switcher in the admin header. */
export function AdminNav({ current }: { current: "orders" | "products" }) {
  return (
    <nav className="adm-nav" aria-label="Admin sections">
      <a href="/admin/" aria-current={current === "orders" ? "page" : undefined}>Orders</a>
      <a href="/admin/products/" aria-current={current === "products" ? "page" : undefined}>Products</a>
    </nav>
  );
}
