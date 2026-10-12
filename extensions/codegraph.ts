import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CODEGRAPH_SERVER_NAME = "codegraph";
const CODEGRAPH_TOOL_NAME = "mcp__codegraph__codegraph_explore";

const CODEGRAPH_INSTRUCTIONS = `In repositories indexed by CodeGraph (a .codegraph/ directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): \`mcp__codegraph__codegraph_explore\` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): \`codegraph explore "<symbol names or question>"\` prints the same output.

If there is no .codegraph/ directory, skip CodeGraph entirely — indexing is the user's decision.`;

function hasCodegraph(startDir: string): boolean {
	try {
		let cur = resolve(startDir);
		while (true) {
			if (existsSync(join(cur, ".codegraph"))) {
				return true;
			}
			const parent = dirname(cur);
			if (parent === cur) break;
			cur = parent;
		}
	} catch {
		// ignore filesystem errors
	}
	return false;
}

export default function codegraphExtension(pi: ExtensionAPI) {
	let isRegistered = false;

	function registerServer() {
		if (isRegistered) return;
		pi.registerMcpServer(CODEGRAPH_SERVER_NAME, {
			command: "codegraph",
			args: ["serve", "--mcp"],
			exposure: "direct",
			description: "Code intelligence and knowledge graph for codebases indexed with CodeGraph",
		});
		isRegistered = true;
	}

	function unregisterServer() {
		if (!isRegistered) return;
		pi.unregisterMcpServer(CODEGRAPH_SERVER_NAME);
		isRegistered = false;
	}

	// If launched directly from an indexed directory, register upfront for immediate startup connection
	if (hasCodegraph(process.cwd())) {
		registerServer();
	}

	pi.on("session_start", (_event, ctx) => {
		if (hasCodegraph(ctx.cwd)) {
			registerServer();
		} else {
			unregisterServer();
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const indexed = hasCodegraph(ctx.cwd);

		if (indexed) {
			registerServer();

			// Wait up to 3s for the MCP tool to be ready on initial connection
			const start = Date.now();
			while (Date.now() - start < 3000) {
				if (pi.getAllTools().some((t) => t.name === CODEGRAPH_TOOL_NAME)) {
					break;
				}
				await new Promise((r) => setTimeout(r, 50));
			}

			// Add instructions to system prompt
			event.systemPromptOptions.sections.codegraph = CODEGRAPH_INSTRUCTIONS;

			// Ensure tool is active and selected
			if (!event.systemPromptOptions.selectedTools.includes(CODEGRAPH_TOOL_NAME)) {
				event.systemPromptOptions.selectedTools.push(CODEGRAPH_TOOL_NAME);
			}
			const activeTools = pi.getActiveTools();
			if (!activeTools.includes(CODEGRAPH_TOOL_NAME)) {
				pi.setActiveTools([...activeTools, CODEGRAPH_TOOL_NAME]);
			}
		} else {
			unregisterServer();

			// Remove instructions from system prompt
			delete event.systemPromptOptions.sections.codegraph;

			// Ensure tool is not selected or active
			event.systemPromptOptions.selectedTools = event.systemPromptOptions.selectedTools.filter(
				(name) => name !== CODEGRAPH_TOOL_NAME,
			);
			const activeTools = pi.getActiveTools();
			if (activeTools.includes(CODEGRAPH_TOOL_NAME)) {
				pi.setActiveTools(activeTools.filter((name) => name !== CODEGRAPH_TOOL_NAME));
			}
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === CODEGRAPH_TOOL_NAME || event.toolName === "codegraph_explore") {
			if (!hasCodegraph(ctx.cwd)) {
				return {
					block: true,
					reason: "CodeGraph is not initialized in this workspace (no .codegraph directory found).",
				};
			}
		}
	});
}
