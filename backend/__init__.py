"""KissaPrints order backend: checkout pricing, Razorpay payments, photo uploads and the admin API.

Standard library only. The same code runs as a Vercel Function (api/index.py) and inside the local dev
server (tools/serve.py), so the whole order flow can be tested on a laptop without any accounts.
"""
