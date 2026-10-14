import { describe, expect, test } from "bun:test";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { snapshotContext } from "./context.ts";
import extension from "./index.ts";

const assistant = (content: unknown[]) => ({
	role: "assistant", content, api: "openai-responses", provider: "openai", model: "test",
	stopReason: "stop", timestamp: 1,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const entry = (id: string, parentId: string | null, message: unknown) => ({ type: "message", id, parentId, timestamp: new Date().toISOString(), message });

// Fixture shapes intentionally stay independent of Pi's declaration versions.
describe("by-the-way snapshot", () => {
	test("isolates copies, preserves prompt sections, and disables tools", () => {
		const entries = [entry("s", null, { role: "system", content: "base", sections: { rules: "keep" }, toolsAdded: [{ name: "bash" }], timestamp: 1 }), entry("u", "s", { role: "user", content: "main", timestamp: 1 })];
		const result = snapshotContext(entries as any, "fallback");
		expect(result[0]).toMatchObject({ role: "system", content: "base", sections: { rules: "keep" } });
		expect(result[0]).not.toHaveProperty("toolsAdded");
		(result[1] as any).content = "changed";
		expect((entries[1].message as any).content).toBe("main");
		expect((entries[0].message as any).toolsAdded).toHaveLength(1);
	});
	test("includes completed results and closes only pending snapshot calls", () => {
		const entries = [entry("a", null, assistant([{ type: "toolCall", id: "done", name: "read", arguments: {} }, { type: "toolCall", id: "pending", name: "bash", arguments: {} }])), entry("r", "a", { role: "toolResult", toolCallId: "done", toolName: "read", content: [{ type: "text", text: "source" }], isError: false, timestamp: 1 })];
		const result = snapshotContext(entries as any, "base");
		const results = result.filter(m => m.role === "toolResult");
		expect(results).toHaveLength(2);
		expect(results[0].content).toEqual([{ type: "text", text: "source" }]);
		expect(results[1].toolCallId).toBe("pending");
		expect(entries).toHaveLength(2);
	});
	test("honors compaction rather than reintroducing old messages", () => {
		const entries = [entry("old", null, { role: "user", content: "forgotten", timestamp: 1 }), entry("kept", "old", { role: "user", content: "recent", timestamp: 2 }), { type: "compaction", id: "c", parentId: "kept", timestamp: new Date().toISOString(), summary: "earlier summary", firstKeptEntryId: "kept", tokensBefore: 10 }];
		const text = JSON.stringify(snapshotContext(entries as any, "base"));
		expect(text).toContain("earlier summary");
		expect(text).toContain("recent");
		expect(text).not.toContain("forgotten");
	});
});

test("/btw streams independently while busy, renders bounded UI, and cancels only itself", async () => {
	initTheme("dark");
	let command: any;
	const events = new Map<string, Function>();
	// No sendMessage, appendEntry, abort, or session-control APIs are supplied:
	// attempting to mutate the main chain makes this test fail.
	extension({ registerCommand(name: string, options: unknown) { expect(name).toBe("btw"); command = options; }, on(name: string, fn: Function) { events.set(name, fn); } } as any);
	const mainAbort = new AbortController();
	let sideSignal: AbortSignal | undefined;
	let request: any;
	let component: any;
	let renderCount = 0;
	const stream = new AssistantMessageEventStream();
	const ctx = {
		mode: "tui", model: { id: "test", provider: "bifrost", api: "openai-responses" }, signal: mainAbort.signal,
		isIdle: () => false,
		getSystemPrompt: () => "main system",
		sessionManager: { getBranch: () => [entry("u", null, { role: "user", content: "main question", timestamp: 1 })] },
		modelRegistry: { streamSimple(model: unknown, context: unknown, options: any) {
			request = context;
			sideSignal = options.signal;
			// Simulate provider wire conversion, then its onPayload callback.
			const wirePayload = { input: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "prior answer" }] }] };
			const patched = options.onPayload(wirePayload, model);
			expect(patched.input[0].content[0].logprobs).toEqual([]);
			expect(wirePayload.input[0].content[0]).not.toHaveProperty("logprobs");
			return stream;
		} },
		ui: { notify() {}, custom(factory: Function) {
			return new Promise(resolve => {
				component = factory({ terminal: { rows: 24 }, requestRender() { renderCount++; } }, { fg: (_c: string, s: string) => s, bold: (s: string) => s }, {}, resolve);
			});
		} },
	};
	const running = command.handler("Explain the main question", ctx);
	expect(request.messages.at(-1).content).toBe("Explain the main question");
	expect(sideSignal).not.toBe(mainAbort.signal);
	const text = "Wide characters 中文 and emoji 🚀\n".repeat(40);
	stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: assistant([{ type: "text", text }]) } as any);
	await new Promise(resolve => setTimeout(resolve, 0));
	for (const width of [20, 80, 120]) {
		const lines = component.render(width);
		expect(lines.length).toBeLessThanOrEqual(22);
		expect(lines.every((line: string) => visibleWidth(line) <= width)).toBe(true);
	}
	component.handleInput("\x1b[B");
	component.invalidate();
	expect(renderCount).toBeGreaterThan(0);
	component.handleInput("\x1b");
	await running;
	expect(sideSignal?.aborted).toBe(true);
	expect(mainAbort.signal.aborted).toBe(false);
	stream.end();
	// Reentry after cancel is possible and lifecycle cleanup closes that UI.
	const second = command.handler("Another question", ctx);
	events.get("session_shutdown")!();
	await second;
	expect(mainAbort.signal.aborted).toBe(false);
});
