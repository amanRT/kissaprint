import "@/styles/checkout.css";
import "@/styles/admin.css";

export const metadata = { title: "Orders | KissaPrints admin", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="adm-body">{children}</div>;
}
