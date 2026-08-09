#!/usr/bin/env python3
"""Signed webhook test/replay for helio-webhook edge function.

Two modes:
  (default)          Safety test — non-existent subscription_id, no data mutation.
  --replay SUB_ID    Replay a STARTED event for a real subscription row
                     (flips pending -> active + writes transaction/event rows).
                     Pass EMAIL + CLERK_USER_ID envs to write clean identity.

Usage:
  HELIO_WEBHOOK_SHARED_TOKEN=... python3 webhook_replay_test.py
  HELIO_WEBHOOK_SHARED_TOKEN=... EMAIL=x@y.z CLERK_USER_ID=user_x \
      python3 webhook_replay_test.py --replay <sub-uuid>
"""
import hashlib
import hmac
import json
import os
import sys
import urllib.request

TOKEN = os.environ["HELIO_WEBHOOK_SHARED_TOKEN"]
BASE = os.environ.get("SUPABASE_URL", "https://pcvscowltlrxzgxjurcr.supabase.co")
URL = f"{BASE}/functions/v1/helio-webhook"

EMAIL = os.environ.get("EMAIL", "safety-test@example.invalid")
CLERK_USER_ID = os.environ.get("CLERK_USER_ID", "user_safety-test")
PLAN_ID = os.environ.get("PLAN_ID", "df980ef1-e41f-41db-9d04-2ad09da69626")
PAYLINK_ID = os.environ.get("PAYLINK_ID", "6887fd0323a031902fad1edf")
AMOUNT_MINIMAL = os.environ.get("AMOUNT_MINIMAL", "199000000")  # $199 USDC
AMOUNT_DECIMAL = os.environ.get("AMOUNT_DECIMAL", "199.00")

replay_sub = None
for i, a in enumerate(sys.argv):
    if a == "--replay" and i + 1 < len(sys.argv):
        replay_sub = sys.argv[i + 1]

if replay_sub:
    sub_id = replay_sub
    tx_id = f"manual-replay-{replay_sub[:8]}"
else:
    sub_id = "00000000-0000-4000-8000-000000000000"  # non-existent -> safe
    tx_id = "safety-test-noop"

payload = {
    "event": "STARTED",
    "transactionObject": {
        "id": tx_id,
        "paylinkId": PAYLINK_ID,
        "createdAt": "2026-08-09T05:40:00.000Z",
        "meta": {
            "amount": AMOUNT_MINIMAL,
            "totalAmountAsUSD": AMOUNT_MINIMAL,
            "transactionStatus": "SUCCESS",
            "customerDetails": {
                "email": EMAIL,
                "discordUser": None,
                "additionalJSON": json.dumps({
                    "subscription_id": sub_id,
                    "user_id": CLERK_USER_ID,
                    "plan_id": PLAN_ID,
                }),
            },
            "tokenQuote": {"from": "USDC", "fromAmountDecimal": AMOUNT_DECIMAL},
        },
    },
}

raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
sig = hmac.new(TOKEN.encode(), raw, hashlib.sha256).hexdigest()

req = urllib.request.Request(
    URL,
    data=raw,
    method="POST",
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TOKEN}",
        "X-Signature": sig,
    },
)

print(f"mode={'REPLAY' if replay_sub else 'SAFETY'} sub={sub_id}")
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode()
        print(f"HTTP {resp.status}")
        print(body)
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"HTTP {e.code}")
    print(body)
    sys.exit(1)
