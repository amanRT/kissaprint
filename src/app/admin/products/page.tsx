import { ProductsAdmin } from "@/components/admin/products-admin";
import { Icon, LogoLink } from "@/components/ui";
import { requireAdminPage } from "@/lib/server/current-user";

export const metadata = { title: "Products | KissaPrints admin", robots: { index: false, follow: false } };

export default async function AdminProductsPage() {
  const admin = await requireAdminPage("/admin/products/");
  return (
    <ProductsAdmin user={{ name: admin.name, email: admin.email }} logo={<LogoLink label="KissaPrints shop" />}
      icons={{ search: <Icon name="search" />, check: <Icon name="check" />, external: <Icon name="arrow-right" /> }} />
  );
}
