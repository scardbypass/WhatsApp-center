# WA Center v3

Dashboard mobile-first untuk mengelola beberapa akun WhatsApp melalui Baileys.

## Fitur
- Multi-device dengan nama dan nomor custom.
- Pairing Code custom 8 karakter atau QR Code.
- Dynamic WhatsApp Web version lookup dengan fallback agar masalah 405/client-too-old lebih kecil.
- Home dashboard, device screen, chat list, conversation dan kirim pesan teks.
- Storage VPS manager; folder session WhatsApp tidak bisa dihapus dari UI.
- Media upload sukses dihapus segera; file gagal dibersihkan otomatis sesuai `MEDIA_RETENTION_HOURS`.
- WebSocket realtime dengan reconnect otomatis.
- PWA, dark mode, responsive mobile/desktop.
- Semua aksi UI memakai event delegation dan loading state agar tombol tidak terasa diam.

## Jalankan
```bash
cp .env.example .env
nano .env
npm install
npm start
```

Untuk PM2:
```bash
pm2 start server.js --name wa-center
pm2 save
pm2 startup
```

Gunakan HTTPS/Cloudflare Tunnel untuk akses publik dan jangan membagikan `API_TOKEN`.

> Penggunaan WhatsApp/Baileys harus untuk akun yang Anda berwenang gunakan dan mengikuti ketentuan WhatsApp.
