# WA Center — Custom Domain Cloudflare

Contoh:

`http://141.11.160.162:31109/` → `https://wa.scard-project.id`

## 1. Cara kerja

WA Center v9.2 menyediakan menu **Pengaturan → Custom Domain**.

Saat disimpan, server akan:

1. mencari zone aktif di akun Cloudflare;
2. membuat atau memperbarui DNS record `A` ke IP VPS;
3. mengaktifkan Cloudflare Proxy jika dipilih;
4. jika port aplikasi bukan 80/443, membuat **Cloudflare Origin Rule** untuk meneruskan request hostname tersebut ke port aplikasi, misalnya `31109`;
5. menyimpan konfigurasi di `data/domain-settings.json`.

Cloudflare mendukung Origin Rules untuk mengganti destination port pada hostname yang diproxy. Origin Rules tersedia untuk Free, Pro, Business, dan Enterprise. citehttps://developers.cloudflare.com/rules/origin-rules/

## 2. Buat API Token Cloudflare

Di Cloudflare buka **My Profile → API Tokens → Create Token**.

Gunakan token dengan izin minimum yang diperlukan untuk zone yang dipakai:

- Zone → DNS → Edit
- Zone → Origin Rules → Edit / permission yang setara untuk Origin Write
- Zone → Zone → Read jika server perlu mencari zone otomatis

API token lebih disarankan daripada Global API Key. citehttps://developers.cloudflare.com/fundamentals/api/get-started/create-token/

## 3. Tambahkan ke `.env` VPS

```env
API_TOKEN=ganti-dengan-token-wa-center

CLOUDFLARE_API_TOKEN=ganti-dengan-token-cloudflare
# Opsional: jika diisi, pencarian zone tidak perlu dilakukan.
# CLOUDFLARE_ZONE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

CLOUDFLARE_ORIGIN_IP=141.11.160.162
CLOUDFLARE_ORIGIN_PORT=31109
```

**Jangan pernah memasukkan `CLOUDFLARE_API_TOKEN` ke browser atau commit ke GitHub.** Token hanya dibaca backend.

## 4. Restart WA Center

```bash
cd /path/ke/WhatsApp-center
git pull origin main
npm install
pm2 restart wa-center --update-env
```

Sesuaikan nama proses PM2 jika berbeda.

## 5. Setting dari Web

Buka WA Center → **Menu → Custom Domain**.

Isi:

- Hostname: `wa.scard-project.id`
- Origin IP: `141.11.160.162`
- Origin Port: `31109`
- Cloudflare Proxy: **ON**

Klik **Simpan & Hubungkan Otomatis**.

Server akan membuat/memperbarui DNS `A` record dan Origin Rule port.

Cloudflare API membuat DNS record melalui endpoint DNS Records; record yang sudah ada dapat dioverwrite melalui `PUT`. citehttps://developers.cloudflare.com/api/resources/dns/subresources/records/

## 6. Kenapa tidak cukup DNS saja?

DNS hanya menerjemahkan hostname ke alamat IP. Browser tanpa port khusus akan menuju port HTTP/HTTPS standar.

Cloudflare secara default memproxy port HTTP/HTTPS tertentu, sedangkan `31109` bukan port proxy standar. Karena itu WA Center v9.2 menggunakan Cloudflare Origin Rule untuk mengubah destination port menjadi `31109` ketika hostname diproxy. citehttps://developers.cloudflare.com/fundamentals/reference/network-ports/

Origin Rules memang dirancang untuk mengubah destination port ke origin non-standar dan mengharuskan record diproxy melalui Cloudflare. citehttps://developers.cloudflare.com/rules/origin-rules/

## 7. Jika Origin Rule tidak bisa dibuat

Biasanya penyebabnya permission API token kurang.

Alternatif paling sederhana adalah reverse proxy di VPS. Jika Caddy sudah terpasang:

```bash
sudo caddy reverse-proxy --from wa.scard-project.id --to 127.0.0.1:31109
```

Caddy akan menangani HTTPS untuk hostname tersebut.

Alternatif yang sangat bagus adalah **Cloudflare Tunnel**. Tunnel dapat memetakan public hostname langsung ke service lokal seperti `http://localhost:31109`, dan Cloudflare juga mendukung WebSocket. citehttps://developers.cloudflare.com/tunnel/routing/

## 8. Troubleshooting

### Domain masih tidak bisa dibuka

Cek:

```bash
curl -I http://127.0.0.1:31109
```

Pastikan WA Center memang listening di port tersebut.

### DNS sudah benar tetapi 502

Periksa:

- origin IP benar;
- port `31109` terbuka/listening;
- Cloudflare Proxy ON;
- Origin Rule berhasil dibuat;
- firewall VPS tidak memblokir koneksi.

### API Cloudflare error

Pastikan token mempunyai permission DNS Write dan Origin Write pada zone yang benar.

## 9. Rekomendasi produksi

- Gunakan HTTPS melalui Cloudflare.
- Jangan expose API token Cloudflare di frontend.
- Gunakan API token dengan scope hanya pada zone yang diperlukan.
- Tetap gunakan `API_TOKEN` WA Center.
- Untuk keamanan tambahan, pertimbangkan Cloudflare Access/WAF.
- Setelah domain aktif, pertimbangkan membatasi akses langsung ke port `31109` sehingga panel hanya diakses melalui hostname Cloudflare.
