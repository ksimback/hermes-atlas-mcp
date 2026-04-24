// Smoke test: spawn the MCP server over stdio and exercise initialize +
// tools/list + resources/list + one search_projects call. Exits 0 on success.
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const server = spawn("node", [path.join(__dirname, "dist/index.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const pending = new Map();
let nextId = 1;

server.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id).resolve(msg);
        pending.delete(msg.id);
      }
    } catch (e) {
      console.error("Parse error:", e.message, "line:", line);
    }
  }
});

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  server.stdin.write(JSON.stringify(msg) + "\n");
  return new Promise((resolve) => pending.set(id, { resolve }));
}

function sendNotification(method, params) {
  const msg = { jsonrpc: "2.0", method, params };
  server.stdin.write(JSON.stringify(msg) + "\n");
}

async function run() {
  console.log("1. initialize...");
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.0" },
  });
  console.log("   server:", init.result?.serverInfo?.name, init.result?.serverInfo?.version);

  sendNotification("notifications/initialized");

  console.log("2. tools/list...");
  const tools = await send("tools/list", {});
  for (const t of tools.result?.tools || []) {
    console.log(`   - ${t.name}`);
  }
  if ((tools.result?.tools || []).length !== 5) {
    console.error(`   FAIL: expected 5 tools, got ${(tools.result?.tools || []).length}`);
    process.exit(1);
  }

  console.log("3. resources/list...");
  const resources = await send("resources/list", {});
  for (const r of resources.result?.resources || []) {
    console.log(`   - ${r.uri}`);
  }
  if ((resources.result?.resources || []).length !== 4) {
    console.error(`   FAIL: expected 4 resources, got ${(resources.result?.resources || []).length}`);
    process.exit(1);
  }

  console.log("4. tools/call search_projects(query='memory')...");
  const search = await send("tools/call", {
    name: "search_projects",
    arguments: { query: "memory", limit: 3 },
  });
  const text = search.result?.content?.[0]?.text || "";
  console.log("   first 200 chars:", text.slice(0, 200).replace(/\n/g, " | "));
  if (!text.includes("Search results") || text.length < 100) {
    console.error("   FAIL: search returned unexpected shape");
    process.exit(1);
  }

  console.log("5. resources/read hermes-atlas://lists...");
  const lists = await send("resources/read", { uri: "hermes-atlas://lists" });
  const listText = lists.result?.contents?.[0]?.text || "";
  const parsed = JSON.parse(listText);
  console.log(`   got ${parsed.length} lists`);
  if (!Array.isArray(parsed) || parsed.length < 3) {
    console.error("   FAIL: lists resource returned unexpected shape");
    process.exit(1);
  }

  console.log("\nAll smoke tests passed.");
  server.kill();
  process.exit(0);
}

run().catch((err) => {
  console.error("Smoke test error:", err);
  server.kill();
  process.exit(1);
});
