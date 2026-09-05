import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const root = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(root, "server.js");
let source = await fs.readFile(target, "utf8");

const AUTH_MARKER = "WA_CENTER_ENV_SESSION_V9_4";
if (!source.includes(AUTH_MARKER)) {
  const corsAnchor = 'app.use(cors());';
  if (!source.includes(corsAnchor)) throw new Error("WA Center auth anchor tidak ditemukan");
  const sessionBlock = `

const UI_SESSION_COOKIE = "wa_center_ui";
const UI_SESSION_VALUE = crypto.createHmac("sha256", API_TOKEN).update("wa-center-env-session-v1").digest("hex");
// ${AUTH_MARKER}
function setUiSessionCookie(res) {
  if (!API_TOKEN || API_TOKEN === "change-this") return;
  res.setHeader("Set-Cookie", \`\${UI_SESSION_COOKIE}=\${UI_SESSION_VALUE}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000\`);
}
app.use((req, res, next) => {
  if (req.path === "/" || req.path === "/index.html") setUiSessionCookie(res);
  next();
});
`;
  source = source.replace(corsAnchor, corsAnchor + sessionBlock);

  const authLine = 'if (token !== API_TOKEN) return apiError(res, 401, "API token tidak valid");';
  const replacement = 'const cookie = req.headers.cookie?.match(/(?:^|;\\s*)wa_center_ui=([^;]+)/)?.[1] || "";\n  if (token !== API_TOKEN && cookie !== UI_SESSION_VALUE) return apiError(res, 401, "API token tidak valid");';
  if (!source.includes(authLine)) throw new Error("WA Center auth check tidak ditemukan");
  source = source.replace(authLine, replacement);
}

const ENDPOINT_MARKER = "WA_CENTER_ENV_SESSION_ENDPOINT_V9_4";
if (!source.includes(ENDPOINT_MARKER)) {
  const authAnchor = 'app.use("/api", authMiddleware);';
  if (!source.includes(authAnchor)) throw new Error("WA Center API auth anchor tidak ditemukan");
  const endpointBlock = `

app.get("/api/session", (req, res) => {
  if (!API_TOKEN || API_TOKEN === "change-this") return apiError(res, 500, "API_TOKEN belum diset di .env");
  setUiSessionCookie(res);
  res.json({ ok: true, source: "env" });
});
// ${ENDPOINT_MARKER}
`;
  source = source.replace(authAnchor, endpointBlock + authAnchor);
}

await fs.writeFile(target, source, "utf8");
await import("./domain-patch.js");
