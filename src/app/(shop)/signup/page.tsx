import { AuthForm, CheckoutNotice, SwitchLink } from "@/components/auth/forms";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "Create an account | KissaPrints", description: "Create a KissaPrints account to track your orders.", path: "/signup/", noindex: true });

export default function SignupPage() {
  return (
    <div className="wrap auth">
      <div className="co-card auth__card">
        <h1>Create your account</h1>
        <p className="muted">You need an account to order - it keeps all your orders, photos and tracking in one place.</p>
        <CheckoutNotice />
        <AuthForm mode="signup" />
        <p className="auth__alt">Already have an account? <SwitchLink href="/login/">Log in</SwitchLink></p>
      </div>
    </div>
  );
}
