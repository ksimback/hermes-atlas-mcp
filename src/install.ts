/**
 * install.ts — patch the MCP config of the chosen client to register
 * hermes-atlas. Safe against missing/empty/malformed files and existing
 * entries. No dependencies beyond node built-ins.
 */

import fs from "fs";
import path from "path";
import os from "os";

const SERVER_KEY = "hermes-atlas";
const SERVER_ENTRY = {
  command: "npx",
  args: ["-y", "hermes-atlas-mcp"],
};

type Client = "claude-desktop" | "cursor" | "claude-code";

const SUPPORTED_CLIENTS: Client[] = ["claude-desktop", "cursor", "claude-code"];

interface ConfigLocation {
  path: string;
  note: string;
}

function resolveConfigPath(client: Client): ConfigLocation {
  const home = os.homedir();
  const platform = process.platform;

  if (client === "claude-desktop") {
    if (platform === "darwin") {
      return {
        path: path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
        note: "Claude Desktop on macOS",
      };
    }
    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      return {
        path: path.join(appData, "Claude", "claude_desktop_config.json"),
        note: "Claude Desktop on Windows",
      };
    }
    return {
      path: path.join(home, ".config", "Claude", "claude_desktop_config.json"),
      note: "Claude Desktop on Linux (unofficial)",
    };
  }

  if (client === "cursor") {
    return {
      path: path.join(home, ".cursor", "mcp.json"),
      note: "Cursor global MCP config",
    };
  }

  if (client === "claude-code") {
    return {
      path: path.join(home, ".claude.json"),
      note: "Claude Code user-level config",
    };
  }

  throw new Error(`Unsupported client: ${client}`);
}

function readJsonSafe(filePath: string): { data: Record<string, unknown>; existed: boolean } {
  if (!fs.existsSync(filePath)) {
    return { data: {}, existed: false };
  }
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return { data: {}, existed: true };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, existed: true };
    }
    throw new Error("Config root is not an object");
  } catch (e) {
    throw new Error(
      `The config file at ${filePath} is not valid JSON. Fix it manually or move it aside, then re-run. Parse error: ${(e as Error).message}`,
    );
  }
}

function writeJson(filePath: string, data: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function parseArgs(argv: string[]): { client?: Client; force: boolean; printOnly: boolean } {
  let client: Client | undefined;
  let force = false;
  let printOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--client" && argv[i + 1]) {
      client = argv[++i] as Client;
    } else if (a.startsWith("--client=")) {
      client = a.slice(9) as Client;
    } else if (a === "--force" || a === "-f" || a === "--yes" || a === "-y") {
      force = true;
    } else if (a === "--print" || a === "--dry-run") {
      printOnly = true;
    }
  }
  return { client, force, printOnly };
}

function printUsage() {
  console.log(`hermes-atlas-mcp install — register the Hermes Atlas MCP server with an AI client

Usage:
  npx hermes-atlas-mcp install --client <client> [--force] [--print]

Clients:
  claude-desktop    Claude Desktop (macOS, Windows, Linux)
  cursor            Cursor (global ~/.cursor/mcp.json)
  claude-code       Claude Code (~/.claude.json)

Options:
  --client <name>   Which client to configure (required)
  --force, -y       Overwrite an existing "hermes-atlas" entry without prompting
  --print           Print what would change without modifying any files

Examples:
  npx hermes-atlas-mcp install --client claude-desktop
  npx hermes-atlas-mcp install --client cursor --force
  npx hermes-atlas-mcp install --client claude-desktop --print

After install, fully quit and reopen the client so it picks up the new config.`);
}

export async function runInstall(argv: string[]): Promise<number> {
  const { client, force, printOnly } = parseArgs(argv);

  if (!client) {
    printUsage();
    return 1;
  }

  if (!SUPPORTED_CLIENTS.includes(client)) {
    console.error(`Unknown client "${client}". Supported: ${SUPPORTED_CLIENTS.join(", ")}.`);
    return 1;
  }

  const loc = resolveConfigPath(client);
  let read: { data: Record<string, unknown>; existed: boolean };
  try {
    read = readJsonSafe(loc.path);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const config = read.data;

  const servers = (config.mcpServers as Record<string, unknown>) || {};
  const alreadyPresent = Object.prototype.hasOwnProperty.call(servers, SERVER_KEY);

  if (alreadyPresent && !force) {
    console.log(`${loc.note}: an "mcpServers.${SERVER_KEY}" entry already exists at:`);
    console.log(`  ${loc.path}`);
    console.log(`Re-run with --force to overwrite it, or edit the file manually.`);
    return 0;
  }

  const nextServers = { ...servers, [SERVER_KEY]: SERVER_ENTRY };
  const nextConfig = { ...config, mcpServers: nextServers };

  if (printOnly) {
    console.log(`Would write to ${loc.path}:\n`);
    console.log(JSON.stringify(nextConfig, null, 2));
    console.log(`\n(no changes made — --print was set)`);
    return 0;
  }

  try {
    writeJson(loc.path, nextConfig);
  } catch (e) {
    console.error(`Failed to write ${loc.path}: ${(e as Error).message}`);
    return 3;
  }

  const verb = read.existed ? (alreadyPresent ? "Updated" : "Added to") : "Created";
  console.log(`✓ ${verb} ${loc.note} config at:`);
  console.log(`    ${loc.path}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Fully quit and reopen the client (close the window is NOT enough).`);
  console.log(`  2. Start a new chat and look for the tools: search_projects,`);
  console.log(`     get_project, list_by_category, get_guide, ask_atlas.`);
  console.log(`  3. Try asking "search the Hermes atlas for memory providers".\n`);
  return 0;
}

export async function runUninstall(argv: string[]): Promise<number> {
  const { client } = parseArgs(argv);
  if (!client) {
    console.error("Usage: npx hermes-atlas-mcp uninstall --client <claude-desktop|cursor|claude-code>");
    return 1;
  }
  if (!SUPPORTED_CLIENTS.includes(client)) {
    console.error(`Unknown client "${client}". Supported: ${SUPPORTED_CLIENTS.join(", ")}.`);
    return 1;
  }
  const loc = resolveConfigPath(client);
  if (!fs.existsSync(loc.path)) {
    console.log(`No config file at ${loc.path}. Nothing to remove.`);
    return 0;
  }
  const read = readJsonSafe(loc.path);
  const servers = (read.data.mcpServers as Record<string, unknown>) || {};
  if (!Object.prototype.hasOwnProperty.call(servers, SERVER_KEY)) {
    console.log(`No "${SERVER_KEY}" entry found in ${loc.path}. Nothing to remove.`);
    return 0;
  }
  const { [SERVER_KEY]: _removed, ...restServers } = servers;
  const nextConfig = { ...read.data, mcpServers: restServers };
  writeJson(loc.path, nextConfig);
  console.log(`✓ Removed "${SERVER_KEY}" from ${loc.note} at:`);
  console.log(`    ${loc.path}`);
  console.log(`\nRestart the client to pick up the change.`);
  return 0;
}

export { printUsage };
