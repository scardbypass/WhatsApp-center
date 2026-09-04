# WA Center Final

Mobile-first WhatsApp multi-device control center.

## Included
- Native Android-like mobile UI
- Light/dark mode
- Home with all WhatsApp devices
- One-tap wake/open per device
- Custom device names
- Add/edit/delete devices
- Pairing Code / QR flow
- Custom 8-character pairing code request
- Lazy/sleeping WhatsApp sessions
- Auto-sleep
- Reconnect handling
- WebSocket realtime events
- Text/media/document send API
- Temporary media cleanup after successful send
- VPS storage browser with select-all and per-file delete
- Protected WhatsApp auth/session folders
- Settings UI for read receipts, reconnect, auto sleep, theme and media cleanup

## Install on VPS

```bash
cp .env.example .env
nano .env
npm install
npm start
```

Open:

```text
http://YOUR_VPS_IP:3010
```

For production, put Nginx/Caddy in front, use HTTPS/WSS, set a strong API_TOKEN, and run with PM2.

## WhatsApp
The backend uses Baileys for WhatsApp multi-device sessions. Use only accounts you control or are authorized to operate and comply with WhatsApp's terms/policies.

## Important
A sleeping device cannot receive realtime events while its socket is closed. When you open it again, the backend wakes the session and receives new/history events available from WhatsApp.

On a 2 GB VPS, keep only the device(s) you actually need live and use auto-sleep. Six simultaneous live sessions may require more RAM depending on traffic and runtime behavior.

## Pairing-code reliability fix
The pairing endpoint now waits for the Baileys socket to reach the `connecting`/QR lifecycle before calling `requestPairingCode()`. This avoids the common `Connection Closed` race seen when requesting a code immediately after socket creation. Pairing requests are serialized per device.

Use a phone number with country code and digits only, for example `6281234567890`. A custom pairing code must be exactly 8 alphanumeric characters.

If WhatsApp itself returns a 405/408/515 or rejects device linking, that is an upstream/session/network/account condition and cannot be guaranteed away by the UI.
