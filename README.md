# WA Center v8

Multi-device WhatsApp control center using Baileys.

## v8 highlights
- Auto-sleep OFF by default (`AUTO_SLEEP_MINUTES=0`).
- Connection starts are throttled to avoid startup storms.
- Reconnect uses exponential backoff + jitter.
- Live WhatsApp Web version is cached.
- Per-device message persistence is serialized.
- Optimistic sending and realtime chat updates without leaving/re-entering conversations.
- Modern mobile-first UI with redesigned Add WhatsApp onboarding.
- Add WhatsApp offers Pairing Code, QR Code, and a transparent “Nomor Baru” onboarding path.
- “Nomor Baru” does not fake OTP registration; the number is registered in the official WhatsApp app first, then linked here.
- Graceful PM2/system shutdown closes sockets intentionally without scheduling reconnects.

## Recommended 6–20 WA
```env
AUTO_SLEEP_MINUTES=0
MAX_CONCURRENT_STARTS=3
RECONNECT_BASE_MS=4000
RECONNECT_MAX_MS=120000
WA_VERSION_CACHE_MS=600000
MEDIA_RETENTION_HOURS=6
```
