import { describe, expect, test } from "bun:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-responses";
import extension, { patchResponsesLogprobs } from "../responses-logprobs.ts";

const model = { provider: "bifrost", api: "openai-responses" };

describe("shared Responses logprobs compatibility", () => {
	test("patches missing/null logprobs without changing history or unrelated paths", () => {
		const existing = [{ token: "kept", logprob: -0.1 }];
		const untouched = { role: "user", content: [{ type: "input_text", text: "question" }] };
		const payload = { model: "test", input: [
			{ role: "assistant", content: [
				{ type: "output_text", text: "missing" },
				{ type: "output_text", text: "null", logprobs: null },
				{ type: "output_text", text: "existing", logprobs: existing },
				{ type: "input_text", text: "other" },
			] }, untouched,
		] };
		const before = structuredClone(payload);
		for (const provider of ["bifrost", "my-provider"]) {
			const patched = patchResponsesLogprobs(payload, { ...model, provider }) as typeof payload;
			expect(patched.input[0].content[0]).toMatchObject({ logprobs: [] });
			expect(patched.input[0].content[1]).toMatchObject({ logprobs: [] });
			expect(patched.input[0].content[2]).toBe(payload.input[0].content[2]);
			expect(patched.input[0].content[3]).toBe(payload.input[0].content[3]);
			expect(patched.input[1]).toBe(untouched);
			expect(payload).toEqual(before);
			expect(patchResponsesLogprobs(patched, { ...model, provider })).toBeUndefined();
		}
	});

	test("leaves other providers/APIs and non-Responses payloads alone", () => {
		const payload = { input: [{ content: [{ type: "output_text", text: "hello" }] }] };
		expect(patchResponsesLogprobs(payload, { ...model, provider: "openai" })).toBeUndefined();
		expect(patchResponsesLogprobs(payload, { ...model, api: "openai-completions" })).toBeUndefined();
		expect(patchResponsesLogprobs(payload)).toBeUndefined();
		for (const invalid of [null, "text", {}, { input: null }, { input: [null, { content: null }] }]) {
			expect(patchResponsesLogprobs(invalid, model)).toBeUndefined();
		}
	});

	test("real Responses wire conversion invokes the patch before sending", async () => {
		const wireModel = {
			...model, id: "test", name: "Test", baseUrl: "https://example.invalid/v1", reasoning: false,
			input: ["text"], contextWindow: 128000, maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		let sent: any;
		const response = streamSimple(wireModel as any, normalizeContext({ messages: [{
			role: "assistant", api: "openai-responses", provider: "bifrost", model: wireModel.id,
			content: [{ type: "text", text: "prior answer" }], stopReason: "stop", timestamp: 1,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		}, { role: "user", content: "side question", timestamp: 2 }] }), {
			apiKey: "dummy-test-key", onPayload: patchResponsesLogprobs, maxRetries: 0,
			fetch: async (_url, init) => {
				sent = JSON.parse(init!.body as string);
				return new Response(JSON.stringify({ error: { message: "test stops after wire capture" } }), { status: 400, headers: { "content-type": "application/json" } });
			},
		});
		await response.result();
		const outputText = sent.input.flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === "output_text");
		expect(outputText).toHaveLength(1);
		expect(outputText[0].logprobs).toEqual([]);
	});

	test("normal chat hook uses the same patch as the side request", () => {
		let hook: any;
		extension({ on(name: string, handler: unknown) {
			expect(name).toBe("before_provider_request");
			hook = handler;
		} } as any);
		const payload = { input: [{ content: [{ type: "output_text", text: "prior answer" }] }] };
		expect(hook({ payload }, { model })).toEqual(patchResponsesLogprobs(payload, model));
	});
});
