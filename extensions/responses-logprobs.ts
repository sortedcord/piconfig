import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Gateway compatibility: absent/null output_text.logprobs becomes an empty array.
 * Copy only changed wire paths; preserve existing arrays and saved response history.
 * Also used by isolated model requests, which bypass before_provider_request.
 */
export function patchResponsesLogprobs(payload: unknown, model?: { provider: string; api: string }): unknown | undefined {
	if ((model?.provider !== "bifrost" && model?.provider !== "my-provider") || model.api !== "openai-responses") return;
	if (!payload || typeof payload !== "object" || !("input" in payload) || !Array.isArray(payload.input)) return;

	let patchedInput: unknown[] | undefined;
	for (let inputIndex = 0; inputIndex < payload.input.length; inputIndex++) {
		const item = payload.input[inputIndex];
		if (!item || typeof item !== "object" || !Array.isArray(item.content)) continue;

		let patchedContent: unknown[] | undefined;
		for (let contentIndex = 0; contentIndex < item.content.length; contentIndex++) {
			const part = item.content[contentIndex];
			if (!part || typeof part !== "object" || part.type !== "output_text" || part.logprobs != null) continue;

			patchedContent ??= [...item.content];
			patchedContent[contentIndex] = { ...part, logprobs: [] };
		}

		if (patchedContent) {
			patchedInput ??= payload.input.slice();
			patchedInput[inputIndex] = { ...item, content: patchedContent };
		}
	}

	return patchedInput ? { ...payload, input: patchedInput } : undefined;
}

/** Auto-loaded at startup. Run /reload after changing this extension. */
export default function responsesLogprobs(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => patchResponsesLogprobs(event.payload, ctx.model));
}
