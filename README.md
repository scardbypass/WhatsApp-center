# WA Center v7

Multi-device WhatsApp control center using Baileys.

## v7
- Auto-sleep configurable; default `0` (OFF) so 6–20 device can stay live.
- Startup restores registered sessions gradually.
- Connection starts are limited with `MAX_CONCURRENT_STARTS`.
- Reconnect uses exponential backoff + jitter to avoid connection storms.
- Live WhatsApp Web version is cached to reduce repeated lookups.
- Message writes are serialized per device to avoid JSON file races.
- Faster optimistic sending: multiple messages can be sent without waiting for the previous request.
- Mobile-first UI refreshed with glass surfaces, tighter spacing, better touch targets, and cleaner chat layout.

## Recommended 6–20 WA
```env
AUTO_SLEEP_MINUTES=0
MAX_CONCURRENT_STARTS=3
RECONNECT_BASE_MS=4000
RECONNECT_MAX_MS=120000
WA_VERSION_CACHE_MS=600000
```
