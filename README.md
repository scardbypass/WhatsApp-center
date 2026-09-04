Siap. Ini kode text README.md lengkapnya:

# 💜 WA Center v8

> **Multi-WhatsApp Control Center** — kelola banyak akun WhatsApp dari satu web app, dengan chat realtime, pairing QR / Pairing Code, penyimpanan media, dan UI mobile-first.

![WA Center](https://img.shields.io/badge/WA%20Center-v8-6C4DFF?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Baileys](https://img.shields.io/badge/Baileys-7.x-25D366?style=for-the-badge)

---

## ✨ Tentang WA Center

**WA Center** adalah web application untuk mengelola beberapa sesi WhatsApp dari satu dashboard.

Konsepnya:

```text
                    ┌──────────────────────┐
                    │       WA CENTER      │
                    │    Web Dashboard     │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
           WA 01             WA 02            WA 03
           Online            Online            Online
              │                │                │
           Baileys           Baileys          Baileys
              │                │                │
           WhatsApp          WhatsApp         WhatsApp

Target penggunaan adalah 6–20 device, tetapi jumlah sebenarnya bergantung pada RAM VPS, aktivitas pesan, media, dan jumlah chat aktif.

> ⚠️ Catatan: WA Center menggunakan library Baileys untuk komunikasi WhatsApp. Gunakan hanya untuk akun yang Anda miliki/berwenang kelola dan patuhi Terms of Service serta kebijakan WhatsApp.




---

🚀 Fitur Utama

1. Multi WhatsApp

Satu dashboard dapat menampilkan banyak device:

WA 01

WA 02

WA 03

WA 04

dst.


Setiap device memiliki session sendiri sehingga tidak perlu mencampur data akun.

Status device

🟢 Online

🟡 Connecting

🔵 Pairing

🟠 Reconnecting

⚪ Offline

😴 Sleeping jika fitur sleep diaktifkan



---

2. Pairing WhatsApp

WA Center menyediakan dua cara utama untuk menghubungkan akun yang sudah terdaftar:

QR Code

Tambah WhatsApp
       ↓
QR Code
       ↓
Scan menggunakan WhatsApp
       ↓
Perangkat tertaut
       ↓
🟢 Online

Pairing Code

Tambah WhatsApp
       ↓
Masukkan nomor WhatsApp
       ↓
Generate Pairing Code
       ↓
Masukkan kode di WhatsApp
       ↓
🟢 Online

Pairing Code dapat menggunakan kode custom 8 karakter jika didukung oleh versi Baileys yang digunakan.

Nomor Baru

Menu Nomor Baru hanya berfungsi sebagai onboarding.

WA Center tidak berpura-pura membuat akun WhatsApp personal melalui OTP internal.

Alurnya:

Nomor Baru
   ↓
Daftarkan nomor melalui aplikasi WhatsApp resmi
   ↓
Akun aktif
   ↓
Kembali ke WA Center
   ↓
QR / Pairing Code
   ↓
Terhubung


---

💬 3. Chat Realtime

Conversation dirancang supaya tidak perlu:

Kirim pesan
↓
keluar chat
↓
masuk lagi

Pesan baru langsung masuk ke conversation.

Pengiriman

WA Center menggunakan:

optimistic UI

realtime WebSocket

message deduplication

per-device persistence

send state

error recovery

auto scroll ketika relevan


Contoh:

Anda
┌──────────────────────────┐
│ Halo 👋             14:21│
└──────────────────────────┘

Teman
┌──────────────────────────┐
│ Halo juga           14:22│
└──────────────────────────┘


---

📎 4. Media & File

WA Center mendukung pengiriman file melalui composer.

Konfigurasi:

MAX_UPLOAD_MB=50
MEDIA_RETENTION_HOURS=6

File sementara disimpan di VPS.

Setelah proses berhasil, file dapat dibersihkan sesuai mekanisme retention.

Prinsip penyimpanan

Upload
   ↓
Temporary media
   ↓
Send WhatsApp
   ↓
Success
   ↓
Cleanup

Folder session WhatsApp tidak dianggap sebagai media dan tidak boleh dihapus sembarangan.


---

💾 5. Storage Manager

Dashboard menyediakan informasi:

total storage

session

media

message data

cleanup media


Jangan menghapus folder session secara manual jika device masih digunakan.

Menghapus session dapat menyebabkan device harus pairing ulang.


---

🔄 6. Reconnect Stabil

Untuk banyak WhatsApp, masalah umum adalah semua socket mencoba reconnect bersamaan.

v8 menggunakan:

Startup throttling

MAX_CONCURRENT_STARTS=3

Jadi tidak semua device dipaksa connect bersamaan.

Exponential backoff

RECONNECT_BASE_MS=4000
RECONNECT_MAX_MS=120000

Semakin sering gagal, interval reconnect semakin panjang.

Ditambah jitter agar beberapa device tidak reconnect pada detik yang sama.


---

😴 7. Auto Sleep

Default v8: OFF

AUTO_SLEEP_MINUTES=0

Artinya device tidak otomatis tidur.

Jika ingin mengaktifkan:

AUTO_SLEEP_MINUTES=30

Maka device yang idle sesuai konfigurasi dapat masuk mode sleep.

Untuk penggunaan 6–20 WhatsApp yang harus selalu menerima realtime message, rekomendasi:

AUTO_SLEEP_MINUTES=0


---

🧠 8. WhatsApp Web Version

v8 menggunakan fetchLatestWaWebVersion() untuk mendapatkan versi WhatsApp Web terbaru jika tersedia.

Hasilnya di-cache:

WA_VERSION_CACHE_MS=600000

600000 ms = 10 menit.

Tujuannya:

mengurangi request berulang

menghindari setiap device melakukan lookup sendiri

membantu mengurangi masalah client revision stale


Jika lookup gagal, aplikasi tetap mempunyai fallback.


---

🏗️ Struktur Sistem

wa-center/
│
├── server.js
├── package.json
├── ecosystem.config.cjs
├── deploy.sh
├── .env
├── .env.example
│
├── public/
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── sw.js
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
│
└── data/
    ├── devices/
    │   ├── device-1/
    │   ├── device-2/
    │   └── ...
    │
    ├── messages/
    └── media/


---

⚙️ Base Code & Arsitektur

Backend

Core backend:

Node.js
   │
   ├── Express
   │
   ├── HTTP Server
   │
   ├── WebSocket
   │
   └── Baileys
          │
          ├── WhatsApp Session
          ├── QR
          ├── Pairing Code
          ├── Messages
          └── Media

Frontend

public/index.html
        │
        ├── Mobile UI
        ├── Device Dashboard
        ├── Chat List
        ├── Conversation
        ├── Pairing Modal
        ├── Storage Manager
        └── WebSocket Client

Runtime

Setiap device memiliki runtime socket sendiri:

Device A → Socket A → Session A
Device B → Socket B → Session B
Device C → Socket C → Session C

Tidak menggunakan satu socket untuk semua nomor.


---

🔌 API

API dilindungi menggunakan:

API_TOKEN=your-secret-token

Endpoint utama:

Method	Endpoint	Fungsi

GET	/health	Health check
GET	/api/devices	Daftar device
POST	/api/devices	Tambah device
DELETE	/api/devices/:id	Hapus device
POST	/api/devices/:id/wake	Menyalakan device
POST	/api/devices/:id/sleep	Sleep device
POST	/api/devices/:id/pairing-code	Request pairing code
GET	/api/devices/:id/messages	Ambil pesan
POST	/api/devices/:id/send	Kirim pesan/file
GET	/api/storage	Informasi storage
DELETE	/api/storage	Hapus storage yang aman
POST	/api/storage/cleanup-media	Cleanup media
WS	/ws	Realtime event



---

🔐 Environment Configuration

Buat:

cp .env.example .env

Contoh:

PORT=3010
HOST=0.0.0.0

API_TOKEN=ganti-dengan-secret-random-panjang

MAX_UPLOAD_MB=50

# 0 = tidak auto sleep
AUTO_SLEEP_MINUTES=0

# Maksimal socket yang mulai bersamaan
MAX_CONCURRENT_STARTS=3

# Reconnect
RECONNECT_BASE_MS=4000
RECONNECT_MAX_MS=120000

# Cache versi WA Web
WA_VERSION_CACHE_MS=600000

# Retention media
MEDIA_RETENTION_HOURS=6

Generate API token aman

Jangan gunakan token contoh.

Gunakan:

openssl rand -hex 32

Masukkan hasilnya ke:

API_TOKEN=HASIL_RANDOM

Kemudian:

chmod 600 .env


---

🖥️ Deploy ke VPS Debian/Ubuntu

Rekomendasi:

Debian 12 / Ubuntu 24.04

Node.js 22 LTS

PM2

Nginx atau Cloudflare Tunnel

HTTPS untuk akses publik


1. Update server

apt update && apt upgrade -y


---

2. Install Git, Curl & Unzip

apt install -y git curl unzip


---

3. Install Node.js 22

Jika Node.js belum tersedia:

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

Cek:

node -v
npm -v

Target:

Node.js 22.x
npm 10.x


---

4. Install PM2

npm install -g pm2

Cek:

pm2 -v


---

5. Upload / Clone Project

Cara A — GitHub

cd /root
git clone https://github.com/scardbypass/WhatsApp-center.git
cd WhatsApp-center

Jika project sudah ada:

cd /root/WhatsApp-center
git pull origin main


---

Cara B — Upload ZIP

Upload ZIP ke VPS, lalu:

cd /root
unzip wa-center-v8.zip

Jika hasilnya:

/root/wa-center-v8

pindahkan:

mv /root/wa-center-v8 /root/WhatsApp-center

Jika folder tujuan sudah ada, backup terlebih dahulu.


---

6. Install Dependencies

cd /root/WhatsApp-center
npm install

Cek:

npm list --depth=0


---

7. Buat Environment

cp .env.example .env
nano .env

Minimal:

PORT=3010
HOST=0.0.0.0
API_TOKEN=ISI_TOKEN_RANDOM
AUTO_SLEEP_MINUTES=0
MAX_CONCURRENT_STARTS=3
RECONNECT_BASE_MS=4000
RECONNECT_MAX_MS=120000
WA_VERSION_CACHE_MS=600000
MEDIA_RETENTION_HOURS=6

Simpan:

CTRL + O
ENTER
CTRL + X

Amankan:

chmod 600 .env


---

8. Test Server

Sebelum PM2:

node --check server.js

Kemudian:

node server.js

Jika benar:

WA Center listening on http://0.0.0.0:3010

Test dari VPS:

curl http://127.0.0.1:3010/health

Harus menghasilkan JSON seperti:

{
  "ok": true,
  "service": "wa-center"
}

Hentikan:

CTRL + C


---

9. Jalankan dengan PM2

cd /root/WhatsApp-center
pm2 start server.js --name wa-center

Cek:

pm2 status

Log:

pm2 logs wa-center

Simpan:

pm2 save

Agar otomatis hidup setelah reboot:

pm2 startup

Jalankan command yang diberikan PM2, lalu:

pm2 save


---

🌐 Online dengan Cloudflare Tunnel

Untuk VPS yang menggunakan Cloudflare Tunnel, aplikasi cukup listen:

HOST=0.0.0.0
PORT=3010

Cloudflared dapat diarahkan ke:

http://127.0.0.1:3010

Contoh konfigurasi:

tunnel: YOUR-TUNNEL-ID
credentials-file: /root/.cloudflared/YOUR-TUNNEL-ID.json

ingress:
  - hostname: wa.example.com
    service: http://127.0.0.1:3010

  - service: http_status:404

Kemudian validasi:

cloudflared tunnel ingress validate

Restart:

systemctl restart cloudflared
systemctl status cloudflared

Test lokal:

curl -I http://127.0.0.1:3010

Test domain:

curl -I https://wa.example.com


---

🔒 HTTPS

Jika menggunakan Cloudflare Tunnel, gunakan HTTPS pada domain publik.

Contoh:

https://wa.example.com

WebSocket menggunakan:

wss://wa.example.com/ws

Jangan menggunakan HTTP publik untuk deployment produksi jika tidak diperlukan.


---

📱 Cara Menghubungkan WhatsApp

Setelah website online:

WA Center
   ↓
+ Tambah WhatsApp
   ↓
Pairing Code / QR Code
   ↓
Hubungkan dari HP
   ↓
Session tersimpan
   ↓
🟢 Online

Untuk pairing code:

1. Buka WhatsApp di HP.


2. Masuk ke Perangkat Tertaut.


3. Pilih opsi menautkan perangkat menggunakan nomor/kode sesuai tampilan WhatsApp.


4. Masukkan pairing code dari WA Center.


5. Tunggu sampai device berubah menjadi Online.




---

🧹 Update Versi Berikutnya

Jika source berasal dari Git:

cd /root/WhatsApp-center
git pull origin main
npm install
node --check server.js
pm2 restart wa-center --update-env
pm2 save

⚠️ Jangan lakukan ini sembarangan

rm -rf data

atau:

rm -rf data/devices

Karena session WhatsApp dapat hilang.


---

🛡️ Backup

Backup project tanpa menghapus data aktif:

cd /root

tar -czf wa-center-backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  WhatsApp-center/.env \
  WhatsApp-center/data

Cek:

ls -lh /root/wa-center-backup-*.tar.gz

Simpan backup ke server/storage lain jika memungkinkan.


---

🔍 Troubleshooting

Port sudah digunakan

ss -ltnp | grep :3010

Cek PM2:

pm2 status
pm2 logs wa-center --lines 100

Jangan menjalankan node server.js bersamaan dengan PM2 jika PM2 sudah menjalankan server.


---

UI lama masih muncul

Karena PWA menggunakan service worker:

1. Tutup tab WA Center.


2. Buka kembali domain.


3. Hard refresh jika diperlukan.


4. Jika tetap lama, hapus site data/cache untuk domain WA Center.




---

Pesan tidak langsung muncul

Cek:

pm2 logs wa-center --lines 100

Pastikan WebSocket dapat tersambung:

wss://domain-anda/ws


---

WhatsApp putus

Jangan langsung hapus session.

Pertama cek:

pm2 logs wa-center --lines 200

Perhatikan:

status code

connection closed

reconnect

pairing

authentication error


Kemudian lakukan reconnect/wake dari dashboard.


---

📊 Rekomendasi VPS

Tidak ada angka RAM yang menjamin jumlah WhatsApp tertentu karena beban tiap akun berbeda.

Sebagai titik awal:

Device	VPS	Catatan

1–3	2 GB	ringan
4–6	4 GB	lebih aman
6–10	8 GB	rekomendasi awal
10–20	8–16 GB	tergantung aktivitas
20+	evaluasi khusus	monitoring wajib


Beban akan meningkat jika banyak:

group

pesan realtime

media

download/upload

chat history

reconnect

akun aktif bersamaan


Untuk 6–20 device, pantau:

free -h
top
pm2 monit


---

🧪 Monitoring

Cek proses:

pm2 status

Cek memory:

pm2 monit

Cek server:

curl http://127.0.0.1:3010/health

Cek port:

ss -ltnp | grep :3010


---

🔐 Security Checklist

Sebelum production:

[ ] Ganti API_TOKEN

[ ] chmod 600 .env

[ ] Jangan commit .env

[ ] Gunakan HTTPS

[ ] Batasi akses SSH

[ ] Aktifkan firewall

[ ] Backup data/

[ ] Jangan share session WhatsApp

[ ] Jangan publish pairing code

[ ] Jangan memasukkan token/API key ke screenshot atau GitHub

[ ] Update dependencies secara terkontrol


Firewall contoh:

ufw allow OpenSSH
ufw enable

Jika menggunakan Cloudflare Tunnel, port 3010 tidak harus dibuka ke internet secara langsung.


---

📦 package.json

Core stack v8:

Node.js
Express
Baileys
WebSocket
Pino
Multer
dotenv

Install semuanya dengan:

npm install

Jangan menjalankan:

npm install @whiskeysockets/baileys@latest

secara sembarangan pada production jika belum dites, karena perubahan versi library dapat mempengaruhi pairing/session.


---

🗺️ Alur Production

INTERNET
                            │
                            ▼
                    Cloudflare / HTTPS
                            │
                            ▼
                    ┌───────────────┐
                    │   WA Center   │
                    │   Port 3010   │
                    └───────┬───────┘
                            │
                ┌───────────┼───────────┐
                │           │           │
                ▼           ▼           ▼
             WA 01       WA 02       WA 03
             Socket      Socket      Socket
                │           │           │
                ▼           ▼           ▼
             WhatsApp    WhatsApp    WhatsApp

                    + WA 04 ... WA 20


---

🎯 Prinsip v8

WA Center v8 dibuat dengan beberapa prinsip:

1. Realtime first

Pesan tidak membutuhkan reload halaman.

2. Mobile first

UI dirancang terlebih dahulu untuk layar HP.

3. Session isolated

Setiap WhatsApp memiliki session sendiri.

4. Connection controlled

Startup dan reconnect tidak dilakukan secara brutal.

5. No fake registration

Nomor baru tidak dibuat melalui endpoint internal yang tidak resmi.

6. Production aware

.env, session, backup, HTTPS dan storage dipisahkan dari source code.


---

📌 Catatan Penting

WA Center adalah software pihak ketiga yang menggunakan library komunikasi WhatsApp. Perilaku WhatsApp dapat berubah sewaktu-waktu.

Pairing dapat gagal walaupun konfigurasi server benar karena:

perubahan protokol WhatsApp

pembatasan sementara

session bermasalah

akun/perangkat

network

versi client

perubahan Baileys


Jika pairing gagal, jangan langsung menghapus seluruh data/.

Selalu cek log terlebih dahulu:

pm2 logs wa-center --lines 200


---

❤️ WA Center

One dashboard. Multiple WhatsApp. Realtime.

WA Center v8
Multi WhatsApp Control Center

Dibuat untuk deployment VPS, mobile-first usage, dan pengelolaan multi-device dengan arsitektur yang dapat dikembangkan.
