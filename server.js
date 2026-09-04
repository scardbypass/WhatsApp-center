
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
  downloadMediaMessage
} from "@whiskeysockets/baileys";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3010);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const DEVICES_DIR = path.join(DATA_DIR, "devices");
const MEDIA_DIR = path.join(DATA_DIR, "media-tmp");
const MESSAGES_DIR = path.join(DATA_DIR, "messages");
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 50);
const AUTO_SLEEP_MINUTES = Number(process.env.AUTO_SLEEP_MINUTES || 15);
const API_TOKEN = process.env.API_TOKEN || "change-this";

const logger = pino({ level: "info" });
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const sockets = new Map(); // deviceId -> { sock, timer, state, authState, readyPromise }
const pairingLocks = new Set();

const upload = multer({
  dest: MEDIA_DIR,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

await fs.mkdir(DEVICES_DIR, { recursive: true });
await fs.mkdir(MEDIA_DIR, { recursive: true });
await fs.mkdir(MESSAGES_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function safeId(id) {
  return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function deviceDir(id) {
  return path.join(DEVICES_DIR, safeId(id));
}

function metaPath(id) {
  return path.join(deviceDir(id), "device.json");
}

function authPath(id) {
  return path.join(deviceDir(id), "auth");
}

function messagesPath(id) {
  return path.join(MESSAGES_DIR, `${safeId(id)}.json`);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  const tmp = `${file}.tmp`;
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

async function readMessages(id) {
  return await readJson(messagesPath(id), []);
}

async function saveMessages(id, messages) {
  const trimmed = messages.slice(-500);
  await writeJson(messagesPath(id), trimmed);
}

function normalizeMessage(m) {
  const key = m.key || {};
  const msg = m.message || {};
  const remoteJid = key.remoteJid || "";
  let text =
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    "";

  const type = Object.keys(msg)[0] || "unknown";
  const timestamp =
    Number(m.messageTimestamp || 0) * 1000 || Date.now();

  return {
    id: key.id || crypto.randomUUID(),
    remoteJid,
    fromMe: !!key.fromMe,
    participant: key.participant || null,
    pushName: m.pushName || "",
    text,
    type,
    timestamp
  };
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(data); } catch {}
    }
  }
}

function authMiddleware(req, res, next) {
  if (req.path === "/health" || req.path === "/") return next();
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
    req.query.token;
  if (!API_TOKEN || API_TOKEN === "change-this") {
    return res.status(500).json({
      error: "Set API_TOKEN in .env before using the API."
    });
  }
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.use("/api", authMiddleware);

function scheduleSleep(id) {
  const current = sockets.get(id);
  if (!current) return;
  if (current.timer) clearTimeout(current.timer);
  current.timer = setTimeout(async () => {
    try {
      await sleepDevice(id, "auto-sleep");
    } catch (e) {
      logger.warn({ err: e, id }, "auto sleep failed");
    }
  }, Math.max(1, AUTO_SLEEP_MINUTES) * 60 * 1000);
}

async function startDevice(id, options = {}) {
  const sid = safeId(id);
  if (!sid) throw new Error("Invalid device id");

  const existing = sockets.get(sid);
  if (existing?.sock) {
    scheduleSleep(sid);
    return existing;
  }

  const meta = await ensureDevice(sid);
  const authDir = authPath(sid);
  await fs.mkdir(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true
  });

  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const readyTimeout = setTimeout(() => {
    rejectReady(new Error("WhatsApp socket did not become ready for pairing within 15 seconds"));
  }, 15000);

  const runtime = {
    sock,
    authState: state,
    timer: null,
    state: "connecting",
    pairingCode: null,
    qr: null,
    readyPromise
  };

  sockets.set(sid, runtime);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection === "connecting" || qr) {
      // A pairing request may be made during the initial handshake. Resolve
      // only after the socket has had a moment to initialise its WebSocket
      // state; calling requestPairingCode too early is a common 408/515 cause.
      clearTimeout(readyTimeout);
      setTimeout(() => resolveReady(), 1200);
    }

    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 360,
          margin: 2
        });
        runtime.qr = qrDataUrl;
        broadcast({
          type: "pairing.qr",
          deviceId: sid,
          qr: qrDataUrl
        });
      } catch (e) {
        logger.error({ err: e }, "QR generation failed");
      }
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
      if (runtime.state !== "open") {
        rejectReady(new Error(`WhatsApp connection closed before pairing (${lastDisconnect?.error?.output?.statusCode || "unknown"})`));
      }
      runtime.state = "closed";
      const code =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.statusCode ||
        null;

      const loggedOut = code === DisconnectReason.loggedOut;

      sockets.delete(sid);

      await updateDevice(sid, {
        status: loggedOut ? "logged_out" : "offline",
        lastError: code ? String(code) : "connection closed"
      });

      broadcast({
        type: "device.close",
        deviceId: sid,
        loggedOut,
        code
      });

      if (!loggedOut && options.reconnect !== false) {
        setTimeout(() => {
          startDevice(sid).catch(err =>
            logger.error({ err, sid }, "reconnect failed")
          );
        }, 2000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const current = await readMessages(sid);
    const normalized = messages
      .filter(m => m?.message)
      .map(normalizeMessage);

    if (!normalized.length) return;

    await saveMessages(sid, [...current, ...normalized]);

    for (const message of normalized) {
      broadcast({
        type: "message",
        deviceId: sid,
        message
      });
    }

    scheduleSleep(sid);
  });

  sock.ev.on("messages.update", updates => {
    broadcast({
      type: "messages.update",
      deviceId: sid,
      updates
    });
  });

  sock.ev.on("messaging-history.set", async ({ messages }) => {
    const current = await readMessages(sid);
    const normalized = messages
      .filter(m => m?.message)
      .map(normalizeMessage);
    if (normalized.length) {
      await saveMessages(sid, [...current, ...normalized]);
      broadcast({
        type: "history",
        deviceId: sid,
        count: normalized.length
      });
    }
  });

  return runtime;
}

async function requestPairing(id, phoneNumber, customCode) {
  if (pairingLocks.has(id)) {
    throw new Error("Pairing request already running for this device");
  }

  pairingLocks.add(id);
  try {
    const runtime = await startDevice(id, { reconnect: false });
    const normalizedNumber = String(phoneNumber || "")
      .replace(/[^\d]/g, "");

    if (!normalizedNumber) {
      throw new Error("Phone number is required, digits only with country code");
    }

    // Baileys can reject pairing if requested before the websocket reaches
    // the connecting/QR phase. Wait for that lifecycle signal first.
    await runtime.readyPromise;

    if (runtime.authState?.creds?.registered) {
      return { alreadyRegistered: true };
    }

    let code;
    const clean = customCode
      ? String(customCode).toUpperCase().replace(/[^A-Z0-9]/g, "")
      : null;
    if (clean && clean.length !== 8) {
      throw new Error("Custom pairing code must be exactly 8 characters");
    }

    // Pairing can transiently fail while the WA websocket is still settling.
    // Retry a few times, but never concurrently for the same device.
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        code = clean
          ? await runtime.sock.requestPairingCode(normalizedNumber, clean)
          : await runtime.sock.requestPairingCode(normalizedNumber);
        break;
      } catch (err) {
        lastError = err;
        if (attempt === 3) break;
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
    if (!code) {
      throw new Error(`Pairing code request failed: ${lastError?.message || "unknown error"}`);
    }

    runtime.pairingCode = code;
    broadcast({
      type: "pairing.code",
      deviceId: safeId(id),
      code
    });

    return { code };
  } finally {
    pairingLocks.delete(id);
  }
}

async function sleepDevice(id, reason = "manual") {
  const sid = safeId(id);
  const runtime = sockets.get(sid);
  if (!runtime) {
    await updateDevice(sid, { status: "offline" });
    return { slept: true, already: true };
  }

  if (runtime.timer) clearTimeout(runtime.timer);
  sockets.delete(sid);

  try {
    runtime.sock.end(undefined);
  } catch {}

  await updateDevice(sid, {
    status: "sleeping",
    lastSeenAt: new Date().toISOString()
  });

  broadcast({
    type: "device.sleep",
    deviceId: sid,
    reason
  });

  return { slept: true };
}

async function deleteDevice(id) {
  const sid = safeId(id);
  const runtime = sockets.get(sid);
  if (runtime) {
    if (runtime.timer) clearTimeout(runtime.timer);
    try {
      await runtime.sock.logout();
    } catch {}
    sockets.delete(sid);
  }

  // Deliberately remove only this device's own directory.
  await fs.rm(deviceDir(sid), { recursive: true, force: true });
  await fs.rm(messagesPath(sid), { force: true });

  broadcast({ type: "device.deleted", deviceId: sid });
}

/* API */

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "wa-center",
    uptime: process.uptime(),
    sockets: sockets.size
  });
});

app.get("/api/devices", async (_req, res) => {
  const devices = await listDeviceMeta();
  const result = devices.map(d => ({
    ...d,
    runtime: sockets.get(d.id)
      ? sockets.get(d.id).state
      : "sleeping"
  }));
  res.json(result);
});

app.post("/api/devices", async (req, res) => {
  try {
    const id =
      safeId(req.body.id) ||
      `wa_${crypto.randomBytes(4).toString("hex")}`;

    const device = await ensureDevice(id, {
      name: req.body.name || id,
      number: req.body.number || ""
    });

    res.json(device);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/devices/:id", async (req, res) => {
  try {
    const id = safeId(req.params.id);
    const allowed = {};
    if (typeof req.body.name === "string") allowed.name = req.body.name.trim();
    if (typeof req.body.number === "string") allowed.number = req.body.number.trim();
    if (typeof req.body.order === "number") allowed.order = req.body.order;

    res.json(await updateDevice(id, allowed));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/devices/:id", async (req, res) => {
  try {
    await deleteDevice(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/devices/:id/wake", async (req, res) => {
  try {
    const runtime = await startDevice(req.params.id);
    res.json({
      ok: true,
      state: runtime.state,
      pairingCode: runtime.pairingCode || null,
      qr: runtime.qr || null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/devices/:id/sleep", async (req, res) => {
  try {
    res.json(await sleepDevice(req.params.id, "manual"));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/devices/:id/pairing-code", async (req, res) => {
  try {
    const id = safeId(req.params.id);
    const meta = await ensureDevice(id);
    const phone = req.body.phone || meta.number;
    const result = await requestPairing(
      id,
      phone,
      req.body.customCode || null
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/devices/:id/messages", async (req, res) => {
  try {
    const messages = await readMessages(req.params.id);
    res.json(messages);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/devices/:id/send", upload.single("file"), async (req, res) => {
  const id = safeId(req.params.id);
  let tempPath = req.file?.path;

  try {
    const runtime = await startDevice(id);
    if (runtime.state !== "open") {
      throw new Error("WhatsApp device is not connected yet");
    }

    const jid = String(req.body.jid || "").trim();
    if (!jid) throw new Error("jid is required");

    let content;

    if (req.file) {
      const mimetype = req.file.mimetype || "application/octet-stream";
      const buffer = await fs.readFile(req.file.path);

      if (mimetype.startsWith("image/")) {
        content = {
          image: buffer,
          mimetype,
          caption: req.body.caption || undefined
        };
      } else if (mimetype.startsWith("video/")) {
        content = {
          video: buffer,
          mimetype,
          caption: req.body.caption || undefined
        };
      } else {
        content = {
          document: buffer,
          mimetype,
          fileName: req.file.originalname || "file",
          caption: req.body.caption || undefined
        };
      }
    } else {
      const text = String(req.body.text || "");
      if (!text) throw new Error("text or file is required");
      content = { text };
    }

    const sent = await runtime.sock.sendMessage(jid, content);

    if (tempPath) {
      await fs.rm(tempPath, { force: true });
      tempPath = null;
    }

    scheduleSleep(id);

    res.json({
      ok: true,
      messageId: sent?.key?.id || null,
      tempDeleted: true
    });
  } catch (e) {
    // Keep failed upload for cleanup instead of deleting immediately.
    res.status(400).json({
      error: e.message,
      tempFileKept: !!tempPath
    });
  }
});

async function walkFiles(root, current = root, out = []) {
  let entries = [];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const e of entries) {
    const full = path.join(current, e.name);
    if (e.isDirectory()) {
      await walkFiles(root, full, out);
    } else {
      try {
        const st = await fs.stat(full);
        out.push({
          path: path.relative(root, full),
          bytes: st.size,
          modifiedAt: st.mtime.toISOString()
        });
      } catch {}
    }
  }

  return out;
}

app.get("/api/storage", async (_req, res) => {
  try {
    const files = await walkFiles(DATA_DIR);
    const total = files.reduce((sum, f) => sum + f.bytes, 0);
    const media = files.filter(f => f.path.startsWith("media-tmp/"));
    const messages = files.filter(f => f.path.startsWith("messages/"));
    const sessions = files.filter(f => f.path.startsWith("devices/"));

    res.json({
      root: DATA_DIR,
      totalBytes: total,
      mediaBytes: media.reduce((s, f) => s + f.bytes, 0),
      messagesBytes: messages.reduce((s, f) => s + f.bytes, 0),
      sessionBytes: sessions.reduce((s, f) => s + f.bytes, 0),
      files
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function safeStoragePath(relative) {
  const normalized = path.normalize(String(relative || ""));
  if (
    normalized.startsWith("..") ||
    path.isAbsolute(normalized)
  ) {
    throw new Error("Invalid path");
  }

  // Protect WhatsApp auth/session folders from this UI.
  if (
    normalized.startsWith("devices") ||
    normalized.includes(`${path.sep}auth${path.sep}`) ||
    normalized.endsWith(`${path.sep}auth`)
  ) {
    throw new Error("WhatsApp session files are protected");
  }

  return path.join(DATA_DIR, normalized);
}

app.delete("/api/storage", async (req, res) => {
  try {
    const paths = Array.isArray(req.body.paths)
      ? req.body.paths
      : [];

    const deleted = [];

    for (const rel of paths) {
      const full = safeStoragePath(rel);

      // Only delete actual files.
      const st = await fs.stat(full);
      if (!st.isFile()) continue;

      await fs.rm(full, { force: true });
      deleted.push(rel);
    }

    res.json({ ok: true, deleted });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/storage/cleanup-media", async (_req, res) => {
  try {
    const files = await walkFiles(MEDIA_DIR, MEDIA_DIR);
    let deleted = 0;
    let bytes = 0;

    for (const f of files) {
      const full = path.join(MEDIA_DIR, f.path);
      bytes += f.bytes;
      await fs.rm(full, { force: true });
      deleted++;
    }

    res.json({ ok: true, deleted, bytes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove abandoned multipart uploads after 6 hours. Successful sends are
// deleted immediately; failed uploads are intentionally retained until this
// housekeeping pass.
setInterval(async () => {
  try {
    const files = await walkFiles(MEDIA_DIR, MEDIA_DIR);
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    for (const f of files) {
      const full = path.join(MEDIA_DIR, f.path);
      if (new Date(f.modifiedAt).getTime() < cutoff) {
        await fs.rm(full, { force: true });
      }
    }
  } catch (e) {
    logger.warn({ err: e }, "media cleanup failed");
  }
}, 30 * 60 * 1000).unref();

wss.on("connection", ws => {
  ws.send(JSON.stringify({
    type: "hello",
    time: new Date().toISOString()
  }));
});

app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, HOST, () => {
  logger.info(
    `WA Center listening on http://${HOST}:${PORT}`
  );
});
