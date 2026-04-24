# hermes-atlas-mcp

MCP server exposing the [Hermes Atlas](https://hermesatlas.com) ecosystem catalog — 100+ community-built tools, skills, plugins, memory providers, workspaces, and integrations for [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent) — to any MCP-aware client (Claude Desktop, Cursor, Continue, Windsurf, etc.).

Ask your AI assistant things like:

- "Search Hermes Atlas for memory providers"
- "What does the hermes-atlas catalog say about the hermes-agent project?"
- "List the top skills for Hermes Agent"
- "Get the Hermes beginner's guide"
- "Ask the atlas: what's the difference between Hermes Agent and Claude Code?"

All catalog data is fetched live from hermesatlas.com (cached in-memory for 1 hour), so tool answers reflect the current ecosystem, not a stale snapshot.

> **Status:** 0.x, experimental. Breaking changes may happen before 1.0. Batch releases weekly.

## Install

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hermes-atlas": {
      "command": "npx",
      "args": ["-y", "hermes-atlas-mcp"]
    }
  }
}
```

Restart Claude Desktop. You should see the five tools (`search_projects`, `get_project`, `list_by_category`, `get_guide`, `ask_atlas`) appear in the tool picker.

### Cursor / Continue / Windsurf

Any MCP-compatible client works the same way. Configure a server named `hermes-atlas` that runs `npx -y hermes-atlas-mcp`.

### From source

```bash
git clone https://github.com/ksimback/hermes-atlas-mcp.git
cd hermes-atlas-mcp
npm install
npm run build
node dist/index.js    # stdio server, pipe JSON-RPC to test
```

## Tools

| Tool | What it does |
|---|---|
| `search_projects` | Ranked keyword search over the catalog. Optional `category` filter. |
| `get_project` | Full summary + metadata + URL for one `owner/repo`. |
| `list_by_category` | Ranked projects in one of the six curated lists. |
| `get_guide` | Full text of the beginner's guide, install guide, or vs-Claude-Code comparison. |
| `ask_atlas` | Free-form RAG question routed to the site's `/api/chat` endpoint. |

## Resources

| URI | Content |
|---|---|
| `hermes-atlas://repos` | Full catalog JSON |
| `hermes-atlas://summaries` | AI-generated summaries JSON |
| `hermes-atlas://lists` | Curated lists JSON |
| `hermes-atlas://ecosystem` | `ECOSYSTEM.md` overview (markdown) |

## Development

```bash
npm install
npm run dev     # tsc --watch
npm run build   # tsc
npm start       # runs dist/index.js on stdio
```

## License

MIT © Kevin Simback. Catalog data is CC0.

## Related

- [hermesatlas.com](https://hermesatlas.com) — the live site
- [ksimback/hermes-ecosystem](https://github.com/ksimback/hermes-ecosystem) — the source repo behind the site
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — the agent this ecosystem is built around
