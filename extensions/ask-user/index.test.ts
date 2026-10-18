import assert from "node:assert";
import { describe, it } from "node:test";
import askUserExtension, {
	CUSTOM_OPTION_LABEL,
	handleAskUser,
	normalizeOptions,
	type AskUserContext,
} from "./index.ts";

describe("normalizeOptions", () => {
	it("returns empty array for empty or undefined input", () => {
		assert.deepStrictEqual(normalizeOptions(undefined), []);
		assert.deepStrictEqual(normalizeOptions([]), []);
	});

	it("normalizes string options", () => {
		const opts = normalizeOptions(["TypeScript", "JavaScript"]);
		assert.strictEqual(opts.length, 2);
		assert.strictEqual(opts[0].label, "TypeScript");
		assert.strictEqual(opts[0].value, "TypeScript");
		assert.strictEqual(opts[0].displayText, "TypeScript");
	});

	it("normalizes object options with description and value", () => {
		const opts = normalizeOptions([
			{ label: "Option 1", value: "opt1", description: "First choice" },
			{ label: "Option 2" },
		]);
		assert.strictEqual(opts.length, 2);
		assert.strictEqual(opts[0].label, "Option 1");
		assert.strictEqual(opts[0].value, "opt1");
		assert.strictEqual(opts[0].displayText, "Option 1 — First choice");
		assert.strictEqual(opts[1].label, "Option 2");
		assert.strictEqual(opts[1].value, "Option 2");
		assert.strictEqual(opts[1].displayText, "Option 2");
	});
});

describe("handleAskUser", () => {
	it("returns error when UI is not available", async () => {
		const ctx: AskUserContext = {
			hasUI: false,
			ui: {} as any,
		};
		const res = await handleAskUser({ question: "Are you sure?" }, undefined, ctx);
		assert.strictEqual(res.isError, true);
		assert.strictEqual(res.details.error, "no_ui");
		assert.strictEqual(res.details.cancelled, true);
	});

	it("handles confirmation (Yes / No)", async () => {
		const ctx: AskUserContext = {
			hasUI: true,
			ui: {
				confirm: async () => true,
			} as any,
		};
		const res = await handleAskUser({ question: "Proceed?", type: "confirm" }, undefined, ctx);
		assert.strictEqual(res.details.confirmed, true);
		assert.strictEqual(res.details.answer, "yes");
		assert.strictEqual(res.details.cancelled, false);
	});

	it("handles option select when option is chosen", async () => {
		const ctx: AskUserContext = {
			hasUI: true,
			ui: {
				select: async (_title: string, options: string[]) => {
					assert.ok(options.includes(CUSTOM_OPTION_LABEL));
					return "Option A";
				},
			} as any,
		};
		const res = await handleAskUser(
			{ question: "Choose one", options: ["Option A", "Option B"] },
			undefined,
			ctx,
		);
		assert.strictEqual(res.details.answer, "Option A");
		assert.strictEqual(res.details.selected_option, "Option A");
		assert.strictEqual(res.details.was_custom, false);
		assert.strictEqual(res.details.cancelled, false);
	});

	it("handles option select with object value mapping", async () => {
		const ctx: AskUserContext = {
			hasUI: true,
			ui: {
				select: async () => "Option A — Detailed description",
			} as any,
		};
		const res = await handleAskUser(
			{
				question: "Choose one",
				options: [{ label: "Option A", value: "opt_a", description: "Detailed description" }],
			},
			undefined,
			ctx,
		);
		assert.strictEqual(res.details.answer, "opt_a");
		assert.strictEqual(res.details.selected_option, "Option A");
		assert.strictEqual(res.details.was_custom, false);
	});

	it("handles option select custom answer option", async () => {
		const ctx: AskUserContext = {
			hasUI: true,
			ui: {
				select: async () => CUSTOM_OPTION_LABEL,
				input: async () => "My unique answer",
			} as any,
		};
		const res = await handleAskUser(
			{ question: "Choose one", options: ["Option A", "Option B"] },
			undefined,
			ctx,
		);
		assert.strictEqual(res.details.answer, "My unique answer");
		assert.strictEqual(res.details.was_custom, true);
		assert.strictEqual(res.details.cancelled, false);
	});

	it("loops back to options menu if user cancels out of custom input", async () => {
		let selectCallCount = 0;
		const ctx: AskUserContext = {
			hasUI: true,
			ui: {
				select: async () => {
					selectCallCount++;
					if (selectCallCount === 1) return CUSTOM_OPTION_LABEL;
					return "Option B";
				},
				input: async () => undefined, // user pressed Escape in input
			} as any,
		};
		const res = await handleAskUser(
			{ question: "Choose one", options: ["Option A", "Option B"] },
			undefined,
			ctx,
		);
		assert.strictEqual(selectCallCount, 2);
		assert.strictEqual(res.details.answer, "Option B");
		assert.strictEqual(res.details.was_custom, false);
	});

	it("handles user cancelling option select", async () => {
		const ctx: AskUserContext = {
			hasUI: true,
			ui: {
				select: async () => undefined,
			} as any,
		};
		const res = await handleAskUser(
			{ question: "Choose one", options: ["Option A", "Option B"] },
			undefined,
			ctx,
		);
		assert.strictEqual(res.details.cancelled, true);
		assert.strictEqual(res.details.answer, null);
	});

	it("handles free-form single-line text input", async () => {
		const ctx: AskUserContext = {
			hasUI: true,
			ui: {
				input: async () => "Hello world",
			} as any,
		};
		const res = await handleAskUser({ question: "Enter message" }, undefined, ctx);
		assert.strictEqual(res.details.answer, "Hello world");
		assert.strictEqual(res.details.was_custom, true);
		assert.strictEqual(res.details.cancelled, false);
	});

	it("handles free-form multi-line editor input", async () => {
		const ctx: AskUserContext = {
			hasUI: true,
			ui: {
				editor: async () => "Line 1\nLine 2",
			} as any,
		};
		const res = await handleAskUser(
			{ question: "Enter config", multiline: true },
			undefined,
			ctx,
		);
		assert.strictEqual(res.details.answer, "Line 1\nLine 2");
		assert.strictEqual(res.details.was_custom, true);
	});

	it("handles text input cancellation", async () => {
		const ctx: AskUserContext = {
			hasUI: true,
			ui: {
				input: async () => undefined,
			} as any,
		};
		const res = await handleAskUser({ question: "Enter message" }, undefined, ctx);
		assert.strictEqual(res.details.cancelled, true);
		assert.strictEqual(res.details.answer, null);
	});
});

describe("askUserExtension", () => {
	it("registers the tool and command with pi", () => {
		const registeredTools: any[] = [];
		const registeredCommands: any[] = [];

		const mockPi: any = {
			registerTool: (tool: any) => registeredTools.push(tool),
			registerCommand: (name: string, opts: any) => registeredCommands.push({ name, ...opts }),
		};

		askUserExtension(mockPi);

		assert.strictEqual(registeredTools.length, 1);
		assert.strictEqual(registeredTools[0].name, "ask_user");
		assert.strictEqual(registeredTools[0].executionMode, "sequential");
		assert.ok(registeredTools[0].promptSnippet);
		assert.ok(registeredTools[0].promptGuidelines.length > 0);

		assert.strictEqual(registeredCommands.length, 1);
		assert.strictEqual(registeredCommands[0].name, "ask");
	});
});
