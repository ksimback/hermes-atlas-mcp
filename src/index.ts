#!/usr/bin/env node
/**
 * hermes-atlas-mcp — MCP server exposing the Hermes Atlas ecosystem catalog.
 *
 * Tools:
 *   search_projects   — keyword search over 100+ Hermes Agent projects
 *   get_project       — fetch a specific project's summary + metadata
 *   list_by_category  — ranked list of projects matching a curated list
 *   get_guide         — fetch a guide page (install, vs-claude-code, hub)
 *   ask_atlas         — delegate a free-form question to the site's RAG endpoint
 *
 * Resources:
 *   hermes-atlas://repos      — full catalog JSON
 *   hermes-atlas://summaries  — AI-generated summaries JSON
 *   hermes-atlas://lists      — curated lists JSON
 *   hermes-atlas://ecosystem  — ECOSYSTEM.md overview
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  loadRepos,
  loadSummaries,
  loadLists,
  loadListSummaries,
  loadEcosystemMarkdown,
  searchRepos,
} from "./catalog.js";

const SITE_URL = "https://hermesatlas.com";

const server = new McpServer({
  name: "hermes-atlas-mcp",
  version: "0.1.0",
});

// ── Tools ────────────────────────────────────────────────────────────────

server.registerTool(
  "search_projects",
  {
    title: "Search Hermes Atlas projects",
    description:
      "Search the Hermes Atlas catalog of 100+ community-built Hermes Agent tools, skills, plugins, memory providers, workspaces, and integrations. Query can be natural language ('memory providers', 'telegram bot', 'vscode plugin'). Optional category filter: 'Core & Official' | 'Workspaces & GUIs' | 'Memory & Context' | 'Skills & Skill Registries' | 'Plugins & Extensions' | 'Integrations & Bridges' | 'Multi-Agent & Orchestration' | 'Developer Tools' | 'Deployment & Infra' | 'Domain Applications' | 'Guides & Docs' | 'Forks & Derivatives'. Optional limit (1-50, default 10).",
    inputSchema: {
      query: z.string(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
  },
  async ({ query, category, limit }) => {
    const [repos, summaries] = await Promise.all([loadRepos(), loadSummaries()]);
    const results = searchRepos(repos, summaries, query, { category, limit });

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No projects matched "${query}"${category ? ` in category "${category}"` : ""}. Try a broader term or drop the category filter.`,
          },
        ],
      };
    }

    const lines = [
      `# Search results for "${query}"${category ? ` (category: ${category})` : ""}`,
      `Found ${results.length} projects, sorted by relevance.`,
      "",
      ...results.map((r, i) => {
        const stars = r.stars.toLocaleString();
        const official = r.official ? " (official)" : "";
        const summary = r.summary ? ` — ${r.summary.slice(0, 220)}` : "";
        return `${i + 1}. **${r.owner}/${r.repo}**${official} · ${r.category} · ${stars}★\n   ${SITE_URL}/projects/${r.owner}/${r.repo}${summary}`;
      }),
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "get_project",
  {
    title: "Get Hermes Atlas project details",
    description:
      "Get the full summary, metadata, and canonical URL for a specific Hermes ecosystem project. Args: owner (GitHub owner, e.g. 'NousResearch'), repo (GitHub repo name, e.g. 'hermes-agent').",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
    },
  },
  async ({ owner, repo }) => {
    const [repos, summaries] = await Promise.all([loadRepos(), loadSummaries()]);
    const found = repos.find(
      (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase(),
    );

    if (!found) {
      return {
        content: [
          {
            type: "text",
            text: `Project ${owner}/${repo} not found in the Hermes Atlas catalog. Use search_projects to discover what's available.`,
          },
        ],
        isError: true,
      };
    }

    const key = `${found.owner}/${found.repo}`;
    const summary = summaries[key];

    const lines = [
      `# ${found.owner}/${found.repo}${found.official ? " (official)" : ""}`,
      `**Category:** ${found.category}`,
      `**Stars:** ${found.stars.toLocaleString()}`,
      `**GitHub:** ${found.url}`,
      `**Canonical URL:** ${SITE_URL}/projects/${found.owner}/${found.repo}`,
      "",
      `**Description:** ${found.description}`,
    ];

    if (summary?.summary) {
      lines.push("", "## Summary", "", summary.summary);
    }
    if (summary?.highlights?.length) {
      lines.push("", "## Highlights", ...summary.highlights.map((h) => `- ${h}`));
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "list_by_category",
  {
    title: "List Hermes Atlas projects by curated list",
    description:
      "Return the ranked list of projects in a Hermes Atlas curated list. Valid slug values: 'best-memory-providers' | 'top-skills' | 'deployment-options' | 'multi-agent-frameworks' | 'developer-tools' | 'workspaces-and-guis'.",
    inputSchema: {
      slug: z.string(),
    },
  },
  async ({ slug }) => {
    const [lists, repos, listSummaries] = await Promise.all([
      loadLists(),
      loadRepos(),
      loadListSummaries(),
    ]);

    const list = lists.find((l) => l.slug === slug);
    if (!list) {
      return {
        content: [
          {
            type: "text",
            text: `List "${slug}" not found. Available: ${lists.map((l) => l.slug).join(", ")}.`,
          },
        ],
        isError: true,
      };
    }

    const matched = repos
      .filter((r) => list.filter?.category && r.category === list.filter.category)
      .sort((a, b) => (b.stars || 0) - (a.stars || 0));

    const entries = listSummaries[slug]?.entries || {};

    const lines = [
      `# ${list.title}`,
      `Canonical URL: ${SITE_URL}/lists/${slug}`,
      "",
      list.description,
      "",
      `## ${matched.length} projects ranked by stars`,
      "",
      ...matched.map((r, i) => {
        const key = `${r.owner}/${r.repo}`;
        const blurb = entries[key] || r.description;
        const stars = r.stars.toLocaleString();
        const official = r.official ? " (official)" : "";
        return `${i + 1}. **${r.owner}/${r.repo}**${official} · ${stars}★\n   ${SITE_URL}/projects/${r.owner}/${r.repo}\n   ${blurb}`;
      }),
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "get_guide",
  {
    title: "Get Hermes Handbook guide page",
    description:
      "Fetch the full text of a Hermes Handbook guide page. Args: slug — one of 'hub' (beginner's guide at /guide/), 'install' (/guide/install/), or 'vs-claude-code' (/guide/vs-claude-code/).",
    inputSchema: {
      slug: z.enum(["hub", "install", "vs-claude-code"]),
    },
  },
  async ({ slug }) => {
    const urlMap: Record<string, string> = {
      hub: "/guide/",
      install: "/guide/install/",
      "vs-claude-code": "/guide/vs-claude-code/",
    };
    const url = `${SITE_URL}${urlMap[slug]}`;
    const res = await fetch(url);
    if (!res.ok) {
      return {
        content: [{ type: "text", text: `Failed to fetch guide: HTTP ${res.status}` }],
        isError: true,
      };
    }
    const html = await res.text();
    const article = html.match(/<article[^>]*id="main"[^>]*>([\s\S]*?)<\/article>/);
    const body = article ? article[1] : html;
    const text = body
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim();

    return {
      content: [
        {
          type: "text",
          text: `# Guide: ${slug}\nCanonical URL: ${url}\n\n${text}`,
        },
      ],
    };
  },
);

server.registerTool(
  "ask_atlas",
  {
    title: "Ask Hermes Atlas (free-form RAG)",
    description:
      "Ask a free-form natural-language question about the Hermes Agent ecosystem. Delegates to the Hermes Atlas RAG endpoint which searches across repos, summaries, guides, and the ECOSYSTEM.md overview, then returns a cited answer. Good for questions like 'What's the best memory provider for production?' or 'How does Hermes compare to Claude Code?'.",
    inputSchema: {
      question: z.string(),
    },
  },
  async ({ question }) => {
    const res = await fetch(`${SITE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, history: [] }),
    });

    if (!res.ok) {
      return {
        content: [
          {
            type: "text",
            text: `ask_atlas failed: HTTP ${res.status}. Try search_projects instead.`,
          },
        ],
        isError: true,
      };
    }

    // /api/chat streams SSE; concatenate text chunks.
    const body = await res.text();
    const lines = body.split("\n");
    const pieces: string[] = [];
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") break;
      try {
        const evt = JSON.parse(payload);
        if (typeof evt.text === "string") pieces.push(evt.text);
        else if (typeof evt.content === "string") pieces.push(evt.content);
      } catch {
        // Non-JSON SSE line — skip.
      }
    }

    const answer = pieces.join("").trim() || body.trim();
    return {
      content: [{ type: "text", text: answer || "(empty response from ask_atlas)" }],
    };
  },
);

// ── Resources ────────────────────────────────────────────────────────────

server.registerResource(
  "hermes-atlas-repos",
  "hermes-atlas://repos",
  {
    title: "Hermes Atlas — full repo catalog",
    description:
      "Full JSON catalog of every project tracked by Hermes Atlas (owner, repo, stars, category, description, URL).",
    mimeType: "application/json",
  },
  async (uri) => {
    const repos = await loadRepos();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(repos, null, 2),
        },
      ],
    };
  },
);

server.registerResource(
  "hermes-atlas-summaries",
  "hermes-atlas://summaries",
  {
    title: "Hermes Atlas — AI-generated project summaries",
    description:
      "Prose summary and highlights per project, generated from the GitHub README via LLM.",
    mimeType: "application/json",
  },
  async (uri) => {
    const summaries = await loadSummaries();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(summaries, null, 2),
        },
      ],
    };
  },
);

server.registerResource(
  "hermes-atlas-lists",
  "hermes-atlas://lists",
  {
    title: "Hermes Atlas — curated lists",
    description:
      "The six editorial lists (best-memory-providers, top-skills, etc.) with category filters.",
    mimeType: "application/json",
  },
  async (uri) => {
    const lists = await loadLists();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(lists, null, 2),
        },
      ],
    };
  },
);

server.registerResource(
  "hermes-atlas-ecosystem",
  "hermes-atlas://ecosystem",
  {
    title: "Hermes Atlas — ECOSYSTEM.md overview",
    description:
      "The hand-curated narrative overview of the Hermes Agent ecosystem. Best starting point for 'what is Hermes and what's in the ecosystem' questions.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const md = await loadEcosystemMarkdown();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: md,
        },
      ],
    };
  },
);

// ── Run ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("hermes-atlas-mcp connected on stdio");
}

main().catch((err) => {
  console.error("hermes-atlas-mcp fatal:", err);
  process.exit(1);
});
