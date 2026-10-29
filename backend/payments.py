"""Razorpay (Orders API + Standard Checkout) and a local stand-in for development.

Flow: the server creates a Razorpay order for the amount it calculated -> the browser opens Razorpay
Checkout -> Razorpay returns payment_id + signature -> the server checks
HMAC_SHA256(razorpay_order_id|payment_id, key_secret). Webhooks are signed the same way over the raw body.
Docs: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request


class PaymentError(RuntimeError):
    """The payment gateway refused or couldn't be reached."""


def _sign(secret: str | bytes, message: str | bytes) -> str:
    key = secret.encode() if isinstance(secret, str) else secret
    msg = message.encode() if isinstance(message, str) else message
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


class Razorpay:
    name = "razorpay"
    API = "https://api.razorpay.com/v1"

    def __init__(self, key_id: str, key_secret: str, webhook_secret: str = ""):
        self.key_id, self.key_secret, self.webhook_secret = key_id, key_secret, webhook_secret

    def _call(self, method: str, path: str, body: dict | None = None, timeout: float = 12) -> dict:
        req = urllib.request.Request(self.API + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None)
        auth = base64.b64encode(f"{self.key_id}:{self.key_secret}".encode()).decode()
        req.add_header("Authorization", f"Basic {auth}")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read()).get("error", {}).get("description", "")
            except (ValueError, AttributeError):
                detail = ""
            raise PaymentError(f"Razorpay error {exc.code}{': ' + detail if detail else ''}") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise PaymentError("Couldn't reach Razorpay - please try again") from None

    def create_order(self, amount_paise: int, receipt: str, notes: dict) -> dict:
        return self._call("POST", "/orders", {"amount": amount_paise, "currency": "INR", "receipt": receipt, "notes": notes})

    def fetch_payment(self, payment_id: str) -> dict:
        return self._call("GET", "/payments/" + urllib.parse.quote(payment_id, safe=""), timeout=6)

    def verify_payment(self, razorpay_order_id: str, payment_id: str, signature: str) -> bool:
        expected = _sign(self.key_secret, f"{razorpay_order_id}|{payment_id}")
        return hmac.compare_digest(expected, str(signature or ""))

    def verify_webhook(self, raw_body: bytes, signature: str) -> bool:
        if not self.webhook_secret:
            return False
        return hmac.compare_digest(_sign(self.webhook_secret, raw_body), str(signature or ""))

    def checkout_options(self, order: dict, rzp_order: dict, image: str) -> dict:
        """Options for `new Razorpay(options)` in the browser (the key ID is public by design)."""
        c = order["customer"]
        return {"gateway": self.name, "key": self.key_id, "order_id": rzp_order["id"], "amount": rzp_order["amount"],
                "currency": "INR", "name": "KissaPrints", "description": f"Order {order['id']}", "image": image,
                "prefill": {"name": c["name"], "email": c["email"], "contact": "+91" + c["phone"]},
                "notes": {"kp_order": order["id"]}, "theme": {"color": "#d7263d"}}


class MockGateway(Razorpay):
    """Local development only: behaves like Razorpay without talking to it. Never enabled on Vercel."""
    name = "mock"

    def __init__(self):
        super().__init__("mock_key", "kissaprints-local-mock-secret")

    def create_order(self, amount_paise: int, receipt: str, notes: dict) -> dict:
        return {"id": "order_mock" + secrets.token_hex(7), "amount": amount_paise, "currency": "INR", "status": "created"}

    def fetch_payment(self, payment_id: str) -> dict:
        return {"id": payment_id, "method": "upi", "status": "captured"}

    def checkout_options(self, order: dict, rzp_order: dict, image: str) -> dict:
        opts = super().checkout_options(order, rzp_order, image)
        # The fake "payment page" in checkout.js sends these back exactly as Razorpay would.
        pay_id = "pay_mock" + secrets.token_hex(7)
        opts["mock"] = {"razorpay_payment_id": pay_id, "razorpay_order_id": rzp_order["id"],
                        "razorpay_signature": _sign(self.key_secret, f"{rzp_order['id']}|{pay_id}")}
        return opts


def gateway(cfg) -> Razorpay | None:
    if cfg.payments == "razorpay":
        return Razorpay(cfg.razorpay_key_id, cfg.razorpay_key_secret, cfg.razorpay_webhook_secret)
    if cfg.payments == "mock":
        return MockGateway()
    return None
