import express from "express";
import "dotenv/config";
import { createProxyMiddleware } from "http-proxy-middleware";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";
import { spawn } from "child_process";

const app = express();
const PORT = process.env.PORT || 10000;
const MCP_PORT = 18080;

// slack-mcp-server を子プロセスでHTTPモード起動（/mcpを内部に持つ）
spawn("npx", ["-y", "@ubie-oss/slack-mcp-server", "-port", String(MCP_PORT)], {
  env: {
    ...process.env,
    "NPM_CONFIG_//npm.pkg.github.com/:_authToken":
      process.env.GH_PACKAGES_TOKEN,
  },
  stdio: "inherit",
});

// 1) 認証: /mcp だけ Bearer 必須
const REQUIRED_TOKEN = process.env.MCP_BEARER_TOKEN;
function auth(req, res, next) {
  if (!REQUIRED_TOKEN) return res.status(500).send("server not configured");
  const h = req.headers.authorization || "";
  const ok = h.startsWith("Bearer ") && h.slice(7) === REQUIRED_TOKEN;
  if (!ok) return res.status(401).send("unauthorized");
  next();
}

// 2) レートリミット: /mcp に適用、/health は除外
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分窓
  max: 30, // 1分に30リクエストまで
  standardHeaders: true,
  legacyHeaders: false,
});

// 3) /health: 軽量疎通のみ。ここにレートリミットや認証はかけない
app.get("/health", async (req, res) => {
  try {
    const r = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const j = await r.json();
    if (j.ok) return res.status(200).send("ok");
  } catch {}
  return res.status(503).send("ng");
});

// 4) /mcp: 認証→レートリミット→プロキシ
app.use(
  "/mcp",
  auth,
  mcpLimiter,
  createProxyMiddleware({
    target: `http://127.0.0.1:${MCP_PORT}/mcp`,
    changeOrigin: false,
  })
);

app.listen(PORT, () => console.log(`wrapper :${PORT} -> mcp :${MCP_PORT}`));
