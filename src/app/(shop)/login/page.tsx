import { AuthForm, CheckoutNotice, SwitchLink } from "@/components/auth/forms";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "Log in | KissaPrints", description: "Log in to order personalised gifts and track your KissaPrints orders.", path: "/login/", noindex: true });

export default function LoginPage() {
  return (
    <div className="wrap auth">
      <div className="co-card auth__card">
        <h1>Log in</h1>
        <p className="muted">Log in to place orders and see their status. The team uses this to open the order dashboard too.</p>
        <CheckoutNotice />
        <AuthForm mode="login" />
        <p className="auth__alt">New to KissaPrints? <SwitchLink href="/signup/">Create an account</SwitchLink></p>
      </div>
    </div>
  );
}
