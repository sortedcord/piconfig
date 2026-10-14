import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { snapshotContext } from "./context.ts";

export default function byTheWay(pi: ExtensionAPI) {
	let active: AbortController | undefined;
	let close: (() => void) | undefined;
	const cleanup = () => {
		active?.abort();
		close?.();
	};
	pi.on("session_shutdown", cleanup);
	pi.on("session_before_switch", cleanup);
	pi.on("session_before_fork", cleanup);
	pi.on("session_before_tree", cleanup);

	pi.registerCommand("btw", {
		description: "Ask an isolated by-the-way question using the current context (no main-chat history)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/btw requires the interactive terminal UI.", "warning");
				return;
			}
			if (active) {
				ctx.ui.notify("A by-the-way question is already open. Close it with Esc first.", "warning");
				return;
			}
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("Select a model before using /btw.", "warning");
				return;
			}
			const controller = new AbortController();
			active = controller;
			try {
				// Capture before even opening the input dialog. Do not wait for idle,
				// use the main turn's signal, or send/append anything to the session.
				const messages = snapshotContext(ctx.sessionManager.getBranch(), ctx.getSystemPrompt());
				const question = (args.trim() || await ctx.ui.input("By the way", "Ask without changing the main conversation…"))?.trim();
				if (!question || controller.signal.aborted) return;
				messages.push({ role: "user", content: question, timestamp: Date.now() });

				await ctx.ui.custom<void>((tui, theme, _kb, done) => {
					let closed = false;
					let finished = false;
					let answer = "";
					let status = `Answering with ${model.id}…`;
					let offset = 0;
					let maxOffset = 0;
					let pageSize = 10;
					const markdown = new Markdown("", 0, 0, getMarkdownTheme());
					const finish = () => {
						if (closed) return;
						closed = true;
						controller.abort();
						done();
					};
					close = finish;

					const run = async () => {
						try {
							const stream = ctx.modelRegistry.streamSimple(model, { messages }, {
								signal: controller.signal,
								sessionId: randomUUID(),
							});
							for await (const event of stream) {
								if (closed) break;
								if (event.type === "text_delta") answer += event.delta;
								if (event.type === "error") throw new Error(event.error.errorMessage || "The model request failed.");
								if (event.type === "done") {
									answer = event.message.content.filter(b => b.type === "text").map(b => b.text).join("\n");
									if (event.message.stopReason === "toolUse") throw new Error("The model requested a tool. /btw does not execute tools.");
								}
								markdown.setText(answer);
								tui.requestRender();
							}
							status = "Complete · not saved to the main conversation";
							if (!answer) markdown.setText("No text answer was returned. Close and try /btw again.");
						} catch (error) {
							status = "Request failed · close and retry with /btw";
							markdown.setText(`${answer}${answer ? "\n\n" : ""}Error: ${error instanceof Error ? error.message : String(error)}`);
						} finally {
							finished = true;
							if (!closed) tui.requestRender();
						}
					};
					void run();
					return {
						render(width: number) {
							pageSize = Math.max(1, Math.floor(tui.terminal.rows * 0.7) - 5);
							const lines = markdown.render(width);
							maxOffset = Math.max(0, lines.length - pageSize);
							offset = Math.min(offset, maxOffset);
							const clip = (s: string) => truncateToWidth(s, width);
							return [
								clip(theme.fg("accent", theme.bold("By the way"))),
								clip(theme.fg("muted", question)),
								...lines.slice(offset, offset + pageSize),
								"",
								clip(theme.fg("muted", status)),
								clip(theme.fg("dim", "↑↓ / PgUp PgDn scroll · Esc close/cancel · Enter close when done")),
							];
						},
						handleInput(data: string) {
							if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || (finished && matchesKey(data, "enter"))) finish();
							else if (matchesKey(data, "up")) offset = Math.max(0, offset - 1);
							else if (matchesKey(data, "down")) offset = Math.min(maxOffset, offset + 1);
							else if (matchesKey(data, "pageUp")) offset = Math.max(0, offset - pageSize);
							else if (matchesKey(data, "pageDown")) offset = Math.min(maxOffset, offset + pageSize);
							else if (matchesKey(data, "home")) offset = 0;
							else if (matchesKey(data, "end")) offset = maxOffset;
							tui.requestRender();
						},
						invalidate() { markdown.invalidate(); },
						dispose() { controller.abort(); },
					};
				}, { overlay: true, overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center" } });
			} catch (error) {
				if (!controller.signal.aborted) ctx.ui.notify(`By the way: ${error instanceof Error ? error.message : String(error)}`, "error");
			} finally {
				controller.abort();
				if (active === controller) { active = undefined; close = undefined; }
			}
		},
	});
}
