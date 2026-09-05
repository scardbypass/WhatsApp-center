import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(root, "server.js");
let source = await fs.readFile(target, "utf8");
const MARKER = "WA_CENTER_CLOUDFLARE_DOMAIN_V9_2";

if (!source.includes(MARKER)) {
  const anchor = 'app.use("/api", authMiddleware);';
  if (!source.includes(anchor)) throw new Error("Cloudflare patch anchor tidak ditemukan");
  const block = `

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "";
const CLOUDFLARE_ORIGIN_IP = process.env.CLOUDFLARE_ORIGIN_IP || process.env.ORIGIN_IP || "141.11.160.162";
const CLOUDFLARE_ORIGIN_PORT = Number(process.env.CLOUDFLARE_ORIGIN_PORT || process.env.ORIGIN_PORT || PORT);
const DOMAIN_SETTINGS_FILE = path.join(DATA_DIR, "domain-settings.json");
// ${MARKER}

function normalizeHostname(value) {
  const hostname = String(value || "").trim().toLowerCase().replace(/^https?:\\/\\//, "").split("/")[0].replace(/\\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$/.test(hostname)) throw new Error("Hostname tidak valid");
  return hostname;
}
function cfHeaders() { return { Authorization: \`Bearer \${CLOUDFLARE_API_TOKEN}\`, "Content-Type": "application/json" }; }
async function cfRequest(url, options = {}) {
  if (!CLOUDFLARE_API_TOKEN) throw new Error("CLOUDFLARE_API_TOKEN belum diset di .env");
  const response = await fetch(url, { ...options, headers: { ...cfHeaders(), ...(options.headers || {}) } });
  const text = await response.text(); let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { errors: [{ message: text || response.statusText }] }; }
  if (!response.ok || data.success === false) throw new Error(data?.errors?.[0]?.message || \`Cloudflare API error \${response.status}\`);
  return data;
}
async function findCloudflareZone(hostname) {
  if (CLOUDFLARE_ZONE_ID) return { id: CLOUDFLARE_ZONE_ID, name: hostname.split(".").slice(-2).join(".") };
  const data = await cfRequest("https://api.cloudflare.com/client/v4/zones?per_page=50&status=active");
  const zones = Array.isArray(data.result) ? data.result : [];
  return zones.filter(z => hostname === z.name || hostname.endsWith(\`.\${z.name}\`)).sort((a, b) => b.name.length - a.name.length)[0] || null;
}
async function ensureOriginRule(zoneId, hostname, port) {
  const endpoint = \`https://api.cloudflare.com/client/v4/zones/\${zoneId}/rulesets/phases/http_request_origin/entrypoint\`;
  let current = { result: { rules: [] } };
  try { current = await cfRequest(endpoint); } catch (err) {
    if (!/404|not found/i.test(String(err.message))) throw err;
  }
  const rules = Array.isArray(current.result?.rules) ? current.result.rules.filter(r => r.ref !== "wa_center_custom_domain") : [];
  rules.push({ ref: "wa_center_custom_domain", expression: \`http.host eq "\${hostname}"\`, description: \`WA Center custom domain \${hostname}\`, action: "route", action_parameters: { origin: { port } }, enabled: true });
  const result = await cfRequest(endpoint, { method: "PUT", body: JSON.stringify({ rules }) });
  return result.result || null;
}
async function getCloudflareDomainStatus() {
  const saved = await readJson(DOMAIN_SETTINGS_FILE, {});
  if (!CLOUDFLARE_API_TOKEN) return { configured: false, ...saved, originIp: CLOUDFLARE_ORIGIN_IP, originPort: CLOUDFLARE_ORIGIN_PORT, message: "Set CLOUDFLARE_API_TOKEN untuk mengaktifkan DNS otomatis." };
  if (!saved.hostname) return { configured: true, originIp: CLOUDFLARE_ORIGIN_IP, originPort: CLOUDFLARE_ORIGIN_PORT, message: "Belum ada custom domain." };
  try {
    const zone = await findCloudflareZone(saved.hostname);
    if (!zone) return { configured: true, ...saved, status: "zone_not_found", originIp: CLOUDFLARE_ORIGIN_IP, originPort: CLOUDFLARE_ORIGIN_PORT };
    const records = await cfRequest(\`https://api.cloudflare.com/client/v4/zones/\${zone.id}/dns_records?type=A&name=\${encodeURIComponent(saved.hostname)}\`);
    const record = records.result?.[0] || null;
    return { configured: true, ...saved, zoneId: zone.id, zoneName: zone.name, recordId: record?.id || null, dnsContent: record?.content || null, proxied: !!record?.proxied, status: record ? "dns_ready" : "dns_missing", originIp: CLOUDFLARE_ORIGIN_IP, originPort: CLOUDFLARE_ORIGIN_PORT, httpsUrl: \`https://\${saved.hostname}\` };
  } catch (err) { return { configured: true, ...saved, status: "error", error: err.message, originIp: CLOUDFLARE_ORIGIN_IP, originPort: CLOUDFLARE_ORIGIN_PORT }; }
}
app.get("/api/settings/domain", async (_req, res) => { try { res.json(await getCloudflareDomainStatus()); } catch (err) { apiError(res, 500, err.message); } });
app.post("/api/settings/domain", async (req, res) => {
  try {
    const hostname = normalizeHostname(req.body.hostname);
    const originIp = String(req.body.originIp || CLOUDFLARE_ORIGIN_IP).trim();
    const originPort = Number(req.body.originPort || CLOUDFLARE_ORIGIN_PORT);
    const proxied = req.body.proxied !== false;
    if (!/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(originIp) || originIp.split(".").some(x => Number(x) > 255)) throw new Error("Origin IPv4 tidak valid");
    if (!Number.isInteger(originPort) || originPort < 1 || originPort > 65535) throw new Error("Origin port tidak valid");
    if (!proxied && originPort !== 80 && originPort !== 443) throw new Error("Untuk port non-standar, aktifkan Cloudflare Proxy (orange cloud).");
    const zone = await findCloudflareZone(hostname);
    if (!zone) throw new Error("Zone domain tidak ditemukan di akun Cloudflare. Pastikan domain sudah ditambahkan dan aktif.");
    const list = await cfRequest(\`https://api.cloudflare.com/client/v4/zones/\${zone.id}/dns_records?name=\${encodeURIComponent(hostname)}&per_page=100\`);
    const existing = Array.isArray(list.result) ? list.result : [];
    const cname = existing.find(r => r.type === "CNAME");
    if (cname) throw new Error("Hostname sudah memiliki CNAME. Hapus CNAME tersebut atau gunakan hostname lain.");
    const body = { type: "A", name: hostname, content: originIp, ttl: 1, proxied, comment: "WA Center custom domain" };
    const aRecord = existing.find(r => r.type === "A");
    const result = aRecord
      ? await cfRequest(\`https://api.cloudflare.com/client/v4/zones/\${zone.id}/dns_records/\${aRecord.id}\`, { method: "PUT", body: JSON.stringify(body) })
      : await cfRequest(\`https://api.cloudflare.com/client/v4/zones/\${zone.id}/dns_records\`, { method: "POST", body: JSON.stringify(body) });
    let originRule = null;
    if (proxied && originPort !== 80 && originPort !== 443) originRule = await ensureOriginRule(zone.id, hostname, originPort);
    const settings = { hostname, originIp, originPort, proxied, zoneId: zone.id, zoneName: zone.name, recordId: result.result?.id || aRecord?.id || null, originRuleId: originRule?.id || null, updatedAt: new Date().toISOString() };
    await writeJson(DOMAIN_SETTINGS_FILE, settings);
    res.json({ ok: true, ...settings, httpsUrl: \`https://\${hostname}\`, reverseProxyRequired: !proxied || (originPort !== 80 && originPort !== 443 && !originRule), message: "DNS Cloudflare berhasil dikonfigurasi." });
  } catch (err) { apiError(res, 400, err.message); }
});`;
  source = source.replace(anchor, anchor + block);
  await fs.writeFile(target, source, "utf8");
}

await import("./runtime-patch.js");
