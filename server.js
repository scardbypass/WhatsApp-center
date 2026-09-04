import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { WebSocketServer } from "ws";
import pino from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  fetchLatestWaWebVersion
} from "@whiskeysockets/baileys";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3010);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const DEVICES_DIR = path.join(DATA_DIR, "devices");
const MEDIA_DIR = path.join(DATA_DIR, "media-tmp");
const MESSAGES_DIR = path.join(DATA_DIR, "messages");
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 50));
const AUTO_SLEEP_MINUTES = Math.max(0, Number(process.env.AUTO_SLEEP_MINUTES || 15));
const MEDIA_RETENTION_HOURS = Math.max(1, Number(process.env.MEDIA_RETENTION_HOURS || 6));
const API_TOKEN = process.env.API_TOKEN || "change-this";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const sockets = new Map();
const pairingLocks = new Set();
const upload = multer({
  dest: MEDIA_DIR,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

await Promise.all([
  fs.mkdir(DEVICES_DIR, { recursive: true }),
  fs.mkdir(MEDIA_DIR, { recursive: true }),
  fs.mkdir(MESSAGES_DIR, { recursive: true })
]);

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  maxAge: 0,
  setHeaders(res) { res.setHeader("Cache-Control", "no-store"); }
}));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeId = id => String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
const deviceDir = id => path.join(DEVICES_DIR, safeId(id));
const metaPath = id => path.join(deviceDir(id), "device.json");
const authPath = id => path.join(deviceDir(id), "auth");
const messagesPath = id => path.join(MESSAGES_DIR, `${safeId(id)}.json`);

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}
async function listDeviceMeta() {
  const entries = await fs.readdir(DEVICES_DIR, { withFileTypes: true });
  const result = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const meta = await readJson(metaPath(e.name), null);
    if (meta) result.push(meta);
  }
  return result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
async function ensureDevice(id, patch = {}) {
  const sid = safeId(id);
  if (!sid) throw new Error("Invalid device id");
  await fs.mkdir(deviceDir(sid), { recursive: true });
  const existing = await readJson(metaPath(sid), null);
  const base = existing || {
    id: sid,
    name: patch.name || sid,
    number: patch.number || "",
    createdAt: new Date().toISOString(),
    order: Date.now(),
    status: "offline",
    lastSeenAt: null,
    lastOpenedAt: null,
    lastError: null
  };
  const next = { ...base, ...patch, id: sid };
  await writeJson(metaPath(sid), next);
  return next;
}
async function updateDevice(id, patch) {
  const current = await ensureDevice(id);
  const next = { ...current, ...patch };
  await writeJson(metaPath(id), next);
  broadcast({ type: "device.update", device: next });
  return next;
}
async function readMessages(id) { return readJson(messagesPath(id), []); }
async function saveMessages(id, messages) {
  const seen = new Set();
  const unique = [];
  for (const m of messages) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id); unique.push(m);
  }
  unique.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  await writeJson(messagesPath(id), unique.slice(-500));
}
function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(data); } catch {}
    }
  }
}
function apiError(res, status, error) { return res.status(status).json({ ok: false, error }); }
function authMiddleware(req, res, next) {
  if (req.path === "/health") return next();
  if (!API_TOKEN || API_TOKEN === "change-this") return apiError(res, 500, "API_TOKEN belum diset di .env");
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.token;
  if (token !== API_TOKEN) return apiError(res, 401, "API token tidak valid");
  next();
}
app.use("/api", authMiddleware);

function scheduleSleep(id) {
  if (!AUTO_SLEEP_MINUTES) return;
  const runtime = sockets.get(id);
  if (!runtime) return;
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = setTimeout(() => {
    sleepDevice(id, "auto-sleep").catch(err => logger.warn({ err, id }, "auto sleep failed"));
  }, AUTO_SLEEP_MINUTES * 60 * 1000);
}

async function getWaVersion() {
  try {
    const latest = await fetchLatestWaWebVersion();
    if (latest?.version) {
      logger.info({ waWebVersion: latest.version, isLatest: latest.isLatest }, "Using live WhatsApp Web version");
      return latest.version;
    }
  } catch (err) {
    logger.warn({ err: err?.message }, "Live WhatsApp Web version lookup failed; using Baileys default");
  }
  return undefined;
}

async function startDevice(id, options = {}) {
  const sid = safeId(id);
  if (!sid) throw new Error("Invalid device id");
  const existing = sockets.get(sid);
  if (existing?.sock && existing.state !== "closed") {
    scheduleSleep(sid);
    return existing;
  }

  const meta = await ensureDevice(sid);
  const authDir = authPath(sid);
  await fs.mkdir(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const version = await getWaVersion();
  const sock = makeWASocket({
    auth: state,
    logger,
    ...(version ? { version } : {}),
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true
  });

  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const readyTimeout = setTimeout(() => rejectReady(new Error("WhatsApp belum siap. Coba tunggu beberapa detik lalu ulangi.")), 20000);
  const runtime = {
    sock,
    authState: state,
    timer: null,
    state: "connecting",
    pairingCode: null,
    qr: null,
    readyPromise,
    createdAt: Date.now()
  };
  sockets.set(sid, runtime);
  await updateDevice(sid, { status: "connecting", lastError: null });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect, qr } = update;
    if (connection === "connecting" || qr) {
      setTimeout(() => resolveReady(), 1200);
      runtime.state = "connecting";
      await updateDevice(sid, { status: "connecting" });
    }
    if (qr) {
      try {
        runtime.qr = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
        broadcast({ type: "pairing.qr", deviceId: sid, qr: runtime.qr });
      } catch (err) { logger.warn({ err, sid }, "QR generation failed"); }
    }
    if (connection === "open") {
      clearTimeout(readyTimeout);
      resolveReady();
      runtime.state = "open";
      runtime.qr = null;
      await updateDevice(sid, {
        status: "online",
        lastSeenAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        lastError: null
      });
      broadcast({ type: "device.open", deviceId: sid });
      scheduleSleep(sid);
    }
    if (connection === "close") {
      clearTimeout(readyTimeout);
      const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || null;
      const loggedOut = code === DisconnectReason.loggedOut;
      const wasOpen = runtime.state === "open";
      runtime.state = "closed";
      logger.warn({ sid, code, error: lastDisconnect?.error?.message || null }, "WhatsApp connection closed");
      if (!wasOpen) rejectReady(new Error(`WhatsApp menutup koneksi (${code || "unknown"})`));
      if (runtime.timer) clearTimeout(runtime.timer);
      sockets.delete(sid);
      await updateDevice(sid, {
        status: loggedOut ? "logged_out" : "offline",
        lastError: code ? String(code) : "connection closed"
      });
      broadcast({ type: "device.close", deviceId: sid, loggedOut, code });
      if (!loggedOut && options.reconnect !== false) {
        setTimeout(() => startDevice(sid).catch(err => logger.warn({ err, sid }, "reconnect failed")), 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const normalized = messages.filter(m => m?.message).map(normalizeMessage);
    if (!normalized.length) return;
    const current = await readMessages(sid);
    await saveMessages(sid, [...current, ...normalized]);
    for (const message of normalized) broadcast({ type: "message", deviceId: sid, message });
    scheduleSleep(sid);
  });
  sock.ev.on("messages.update", updates => broadcast({ type: "messages.update", deviceId: sid, updates }));
  sock.ev.on("messaging-history.set", async ({ messages }) => {
    const normalized = messages.filter(m => m?.message).map(normalizeMessage);
    if (!normalized.length) return;
    const current = await readMessages(sid);
    await saveMessages(sid, [...current, ...normalized]);
    broadcast({ type: "history", deviceId: sid, count: normalized.length });
  });
  return runtime;
}

function normalizeMessage(m) {
  const key = m.key || {};
  const msg = m.message || {};
  const text = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || "";
  return {
    id: key.id || crypto.randomUUID(),
    remoteJid: key.remoteJid || "",
    fromMe: !!key.fromMe,
    participant: key.participant || null,
    pushName: m.pushName || "",
    text,
    type: Object.keys(msg)[0] || "unknown",
    timestamp: Number(m.messageTimestamp || 0) * 1000 || Date.now()
  };
}

async function requestPairing(id, phoneNumber, customCode) {
  const sid = safeId(id);
  if (pairingLocks.has(sid)) throw new Error("Pairing sedang berjalan untuk device ini");
  pairingLocks.add(sid);
  try {
    const runtime = await startDevice(sid, { reconnect: false });
    const normalizedNumber = String(phoneNumber || "").replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(normalizedNumber)) throw new Error("Nomor WhatsApp tidak valid. Gunakan kode negara, contoh 62812xxxxxxx");
    await runtime.readyPromise;
    if (runtime.authState?.creds?.registered) return { alreadyRegistered: true };
    const clean = customCode ? String(customCode).toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
    if (clean && clean.length !== 8) throw new Error("Custom pairing code harus tepat 8 karakter");
    let code;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        code = clean ? await runtime.sock.requestPairingCode(normalizedNumber, clean) : await runtime.sock.requestPairingCode(normalizedNumber);
        break;
      } catch (err) {
        lastError = err;
        if (attempt < 3) await sleep(1800 * attempt);
      }
    }
    if (!code) throw new Error(`Gagal meminta pairing code${lastError?.message ? `: ${lastError.message}` : ""}`);
    runtime.pairingCode = code;
    await updateDevice(sid, { status: "pairing", lastError: null });
    broadcast({ type: "pairing.code", deviceId: sid, code });
    return { code };
  } finally { pairingLocks.delete(sid); }
}

async function sleepDevice(id, reason = "manual") {
  const sid = safeId(id);
  const runtime = sockets.get(sid);
  if (!runtime) return { ok: true, slept: true, already: true };
  if (runtime.timer) clearTimeout(runtime.timer);
  sockets.delete(sid);
  try { runtime.sock.end(undefined); } catch {}
  await updateDevice(sid, { status: "sleeping", lastSeenAt: new Date().toISOString() });
  broadcast({ type: "device.sleep", deviceId: sid, reason });
  return { ok: true, slept: true };
}
async function deleteDevice(id) {
  const sid = safeId(id);
  if (!sid) throw new Error("Invalid device id");
  const runtime = sockets.get(sid);
  if (runtime) {
    if (runtime.timer) clearTimeout(runtime.timer);
    try { await runtime.sock.logout(); } catch {}
    sockets.delete(sid);
  }
  await fs.rm(deviceDir(sid), { recursive: true, force: true });
  await fs.rm(messagesPath(sid), { force: true });
  broadcast({ type: "device.deleted", deviceId: sid });
}

async function walkFiles(root, current = root, out = []) {
  let entries = [];
  try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(current, e.name);
    if (e.isDirectory()) await walkFiles(root, full, out);
    else try {
      const st = await fs.stat(full);
      out.push({ path: path.relative(root, full), bytes: st.size, modifiedAt: st.mtime.toISOString() });
    } catch {}
  }
  return out;
}
function safeStoragePath(relative) {
  const normalized = path.normalize(String(relative || ""));
  if (!normalized || normalized.startsWith("..") || path.isAbsolute(normalized)) throw new Error("Invalid path");
  const protectedPath = normalized === "devices" || normalized.startsWith(`devices${path.sep}`);
  if (protectedPath) throw new Error("Folder session WhatsApp dilindungi");
  return path.join(DATA_DIR, normalized);
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "wa-center", uptime: process.uptime(), sockets: sockets.size }));
app.get("/api/devices", async (_req, res) => {
  try {
    const devices = await listDeviceMeta();
    res.json(devices.map(d => ({ ...d, runtime: sockets.get(d.id)?.state || (d.status === "sleeping" ? "sleeping" : "offline") })));
  } catch (err) { apiError(res, 500, err.message); }
});
app.post("/api/devices", async (req, res) => {
  try {
    const id = safeId(req.body.id) || `wa_${crypto.randomBytes(4).toString("hex")}`;
    const device = await ensureDevice(id, { name: String(req.body.name || id).trim(), number: String(req.body.number || "").trim() });
    res.json(device);
  } catch (err) { apiError(res, 400, err.message); }
});
app.patch("/api/devices/:id", async (req, res) => {
  try {
    const allowed = {};
    if (typeof req.body.name === "string") {
      const name = req.body.name.trim();
      if (!name || name.length > 60) throw new Error("Nama device harus 1–60 karakter");
      allowed.name = name;
    }
    if (typeof req.body.number === "string") allowed.number = req.body.number.trim();
    if (typeof req.body.order === "number" && Number.isFinite(req.body.order)) allowed.order = req.body.order;
    res.json(await updateDevice(safeId(req.params.id), allowed));
  } catch (err) { apiError(res, 400, err.message); }
});
app.delete("/api/devices/:id", async (req, res) => { try { await deleteDevice(req.params.id); res.json({ ok: true }); } catch (err) { apiError(res, 400, err.message); } });
app.post("/api/devices/:id/wake", async (req, res) => { try { const runtime = await startDevice(req.params.id); res.json({ ok: true, state: runtime.state, pairingCode: runtime.pairingCode || null, qr: runtime.qr || null }); } catch (err) { apiError(res, 500, err.message); } });
app.post("/api/devices/:id/sleep", async (req, res) => { try { res.json(await sleepDevice(req.params.id)); } catch (err) { apiError(res, 500, err.message); } });
app.post("/api/devices/:id/pairing-code", async (req, res) => { try { const id = safeId(req.params.id); const meta = await ensureDevice(id); res.json({ ok: true, ...(await requestPairing(id, req.body.phone || meta.number, req.body.customCode || null)) }); } catch (err) { apiError(res, 400, err.message); } });
app.get("/api/devices/:id/messages", async (req, res) => { try { res.json(await readMessages(req.params.id)); } catch (err) { apiError(res, 400, err.message); } });
app.post("/api/devices/:id/send", upload.single("file"), async (req, res) => {
  let tempPath = req.file?.path;
  try {
    const sid = safeId(req.params.id);
    const runtime = await startDevice(sid);
    if (runtime.state !== "open") throw new Error("WhatsApp device belum online");
    const jid = String(req.body.jid || "").trim();
    if (!jid) throw new Error("jid wajib diisi");
    let content;
    let localText = "";
    let localType = "conversation";
    if (req.file) {
      const mimetype = req.file.mimetype || "application/octet-stream";
      const buffer = await fs.readFile(req.file.path);
      const caption = String(req.body.caption || "");
      if (mimetype.startsWith("image/")) { content = { image: buffer, mimetype, caption: caption || undefined }; localType = "imageMessage"; }
      else if (mimetype.startsWith("video/")) { content = { video: buffer, mimetype, caption: caption || undefined }; localType = "videoMessage"; }
      else { content = { document: buffer, mimetype, fileName: req.file.originalname || "file", caption: caption || undefined }; localType = "documentMessage"; }
      localText = caption || `[${localType.replace('Message','')}] ${req.file.originalname || 'file'}`;
    } else {
      localText = String(req.body.text || "");
      if (!localText) throw new Error("text atau file wajib diisi");
      content = { text: localText };
    }
    const sent = await runtime.sock.sendMessage(jid, content);
    if (tempPath) { await fs.rm(tempPath, { force: true }); tempPath = null; }
    const message = {
      id: sent?.key?.id || crypto.randomUUID(),
      remoteJid: sent?.key?.remoteJid || jid,
      fromMe: true,
      participant: sent?.key?.participant || null,
      pushName: "",
      text: localText,
      type: localType,
      timestamp: Number(sent?.messageTimestamp || 0) * 1000 || Date.now()
    };
    const current = await readMessages(sid);
    await saveMessages(sid, [...current, message]);
    broadcast({ type: "message", deviceId: sid, message });
    scheduleSleep(sid);
    res.json({ ok: true, messageId: message.id, message, tempDeleted: true });
  } catch (err) {
    if (tempPath) {
      try { await fs.rm(tempPath, { force: true }); } catch {}
    }
    apiError(res, 400, err.message);
  }
});
app.get("/api/storage", async (_req, res) => {
  try {
    const files = await walkFiles(DATA_DIR);
    const sum = prefix => files.filter(f => f.path === prefix || f.path.startsWith(`${prefix}/`)).reduce((n, f) => n + f.bytes, 0);
    res.json({ root: DATA_DIR, totalBytes: files.reduce((n, f) => n + f.bytes, 0), sessionBytes: sum("devices"), mediaBytes: sum("media-tmp"), messagesBytes: sum("messages"), files });
  } catch (err) { apiError(res, 500, err.message); }
});
app.delete("/api/storage", async (req, res) => {
  try {
    const paths = Array.isArray(req.body.paths) ? req.body.paths : [];
    const deleted = [];
    for (const rel of paths) {
      const full = safeStoragePath(rel);
      let st; try { st = await fs.stat(full); } catch { continue; }
      if (!st.isFile()) continue;
      await fs.rm(full, { force: true });
      deleted.push(rel);
    }
    res.json({ ok: true, deleted });
  } catch (err) { apiError(res, 400, err.message); }
});
app.post("/api/storage/cleanup-media", async (_req, res) => {
  try {
    const files = await walkFiles(MEDIA_DIR, MEDIA_DIR);
    let deleted = 0, bytes = 0;
    for (const f of files) { await fs.rm(path.join(MEDIA_DIR, f.path), { force: true }); deleted++; bytes += f.bytes; }
    res.json({ ok: true, deleted, bytes });
  } catch (err) { apiError(res, 500, err.message); }
});
setInterval(async () => {
  try {
    const files = await walkFiles(MEDIA_DIR, MEDIA_DIR);
    const cutoff = Date.now() - MEDIA_RETENTION_HOURS * 3600 * 1000;
    for (const f of files) if (new Date(f.modifiedAt).getTime() < cutoff) await fs.rm(path.join(MEDIA_DIR, f.path), { force: true });
  } catch (err) { logger.warn({ err: err?.message }, "media cleanup failed"); }
}, 30 * 60 * 1000).unref();

wss.on("connection", ws => ws.send(JSON.stringify({ type: "hello", time: new Date().toISOString() })));
app.get("/{*splat}", (req, res, next) => { if (req.path.startsWith("/api/")) return next(); res.sendFile(path.join(__dirname, "public", "index.html")); });
server.listen(PORT, HOST, () => logger.info(`WA Center listening on http://${HOST}:${PORT}`));
