import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(root, "server.js");
const MARKER = "WA_CENTER_CONTACTS_V9_1";

let source = await fs.readFile(target, "utf8");
if (!source.includes(MARKER)) {
  const replacements = [
    [
      'const MESSAGES_DIR = path.join(DATA_DIR, "messages");',
      'const MESSAGES_DIR = path.join(DATA_DIR, "messages");\nconst CONTACTS_DIR = path.join(DATA_DIR, "contacts");\n// WA_CENTER_CONTACTS_V9_1'
    ],
    [
      '  fs.mkdir(MESSAGES_DIR, { recursive: true })',
      '  fs.mkdir(MESSAGES_DIR, { recursive: true }),\n  fs.mkdir(CONTACTS_DIR, { recursive: true })'
    ],
    [
      'const messagesPath = id => path.join(MESSAGES_DIR, `${safeId(id)}.json`);',
      'const messagesPath = id => path.join(MESSAGES_DIR, `${safeId(id)}.json`);\nconst contactsPath = id => path.join(CONTACTS_DIR, `${safeId(id)}.json`);'
    ],
    [
      'function persistMessages(id, additions) {',
      'async function persistContacts(id, contacts) {\n  const sid = safeId(id);\n  const current = await readJson(contactsPath(sid), {});\n  for (const c of contacts || []) {\n    const cid = String(c?.id || "").trim();\n    if (!cid) continue;\n    current[cid] = {\n      id: cid,\n      name: String(c?.name || "").trim(),\n      notify: String(c?.notify || "").trim(),\n      verifiedName: String(c?.verifiedName || "").trim()\n    };\n  }\n  await writeJson(contactsPath(sid), current);\n  const runtime = sockets.get(sid);\n  if (runtime) for (const c of contacts || []) {\n    const cid = String(c?.id || "").trim();\n    if (cid) runtime.contacts.set(cid, current[cid]);\n  }\n}\n\nfunction contactDisplayName(contact) {\n  if (!contact) return "";\n  return String(contact.name || contact.notify || contact.verifiedName || "").trim();\n}\n\nfunction persistMessages(id, additions) {'
    ],
    [
      '      readyPromise,\n      createdAt: Date.now()',
      '      readyPromise,\n      contacts: new Map(),\n      createdAt: Date.now()'
    ],
    [
      '    sockets.set(sid, runtime);\n    await updateDevice(sid, { status: "connecting", lastError: null });\n    sock.ev.on("creds.update", saveCreds);',
      '    sockets.set(sid, runtime);\n    const storedContacts = await readJson(contactsPath(sid), {});\n    for (const [cid, contact] of Object.entries(storedContacts || {})) runtime.contacts.set(cid, contact);\n    await updateDevice(sid, { status: "connecting", lastError: null });\n    sock.ev.on("creds.update", saveCreds);\n    sock.ev.on("contacts.upsert", contacts => { persistContacts(sid, contacts).catch(err => logger.warn({ sid, err: err?.message }, "contacts upsert failed")); });\n    sock.ev.on("contacts.update", contacts => { persistContacts(sid, contacts).catch(err => logger.warn({ sid, err: err?.message }, "contacts update failed")); });'
    ],
    [
      '      if (connection === "connecting" || qr) {\n        setTimeout(() => resolveReady(), 1200);\n        runtime.state = "connecting";',
      '      if (connection === "connecting" || qr) {\n        runtime.state = "connecting";'
    ],
    [
      '    sock.ev.on("messaging-history.set", async ({ messages }) => {',
      '    sock.ev.on("messaging-history.set", async ({ messages, contacts }) => {\n      if (contacts?.length) await persistContacts(sid, contacts);'
    ],
    [
      'app.get("/api/devices/:id/messages", async (req, res) => { try { res.json(await readMessages(req.params.id)); } catch (err) { apiError(res, 400, err.message); } });',
      'app.get("/api/devices/:id/contacts", async (req, res) => {\n  try {\n    const sid = safeId(req.params.id);\n    const stored = await readJson(contactsPath(sid), {});\n    const runtime = sockets.get(sid);\n    const result = { ...stored };\n    if (runtime?.contacts) for (const [id, contact] of runtime.contacts) result[id] = contact;\n    const messages = await readMessages(sid);\n    const jids = [...new Set(messages.map(m => m?.remoteJid).filter(Boolean))];\n    if (runtime?.sock) {\n      for (const jid of jids.filter(x => x.endsWith("@g.us"))) {\n        try {\n          const group = await runtime.sock.groupMetadata(jid);\n          if (group?.subject) result[jid] = { id: jid, name: group.subject, notify: group.subject, verifiedName: "" };\n        } catch {}\n      }\n    }\n    res.json(result);\n  } catch (err) { apiError(res, 400, err.message); }\n});\napp.get("/api/devices/:id/messages", async (req, res) => { try { res.json(await readMessages(req.params.id)); } catch (err) { apiError(res, 400, err.message); } });'
    ],
    [
      '    try { await runtime.sock.logout(); } catch {}',
      '    runtime.intentionalClose = true;\n    clearReconnect(sid);\n    try { await runtime.sock.logout(); } catch {}'
    ]
  ];

  for (const [from, to] of replacements) {
    if (!source.includes(from)) throw new Error(`Runtime patch anchor tidak ditemukan: ${from.slice(0, 70)}`);
    source = source.replace(from, to);
  }
  await fs.writeFile(target, source, "utf8");
}

await import("./server.js");
