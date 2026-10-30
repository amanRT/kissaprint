import { AdminApp } from "@/components/admin/admin-app";
import { Icon, LogoLink } from "@/components/ui";
import { settings } from "@/lib/server/config";
import { requireAdminPage } from "@/lib/server/current-user";

// Only admins get here: proxy.ts checks the JWT's isAdmin claim first, and this page re-checks the user's
// is_admin flag in the database on every request (so revoking admin rights takes effect immediately).
export default async function AdminPage() {
  const admin = await requireAdminPage("/admin/");
  const cfg = settings();
  const mode = cfg.payments === "mock" ? "Local test mode" : cfg.payments === "" ? "Payments not set up" : cfg.testMode ? "Razorpay test mode" : "";
  return (
    <AdminApp
      user={{ name: admin.name, email: admin.email }}
      mode={mode + (cfg.payments === "razorpay" && !cfg.razorpayWebhookSecret ? " · webhook not set" : "")}
      problems={cfg.problems}
      logo={<LogoLink label="KissaPrints shop" />}
      icons={{ refresh: <Icon name="refresh" />, search: <Icon name="search" />, close: <Icon name="close" />, check: <Icon name="check" /> }}
    />
  );
}
