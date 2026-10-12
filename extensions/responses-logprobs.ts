import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * Gateway compatibility: absent/null output_text.logprobs becomes an empty array.
 * Copy only changed wire paths; preserve existing arrays and saved response history.
 * Auto-loaded at startup. Use /restart after installing or changing this extension.
 * Calls bypassing before_provider_request, including some compaction paths, are not covered.
 */
export default function responsesLogprobs(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => {
		if ((ctx.model?.provider !== "bifrost" && ctx.model?.provider !== "my-provider") || ctx.model.api !== "openai-responses") return;

		const payload = event.payload;
		if (!payload || typeof payload !== "object" || !("input" in payload) || !Array.isArray(payload.input)) return;

		let patchedInput: unknown[] | undefined;
		for (let inputIndex = 0; inputIndex < payload.input.length; inputIndex++) {
			const item = payload.input[inputIndex];
			if (!item || typeof item !== "object" || !Array.isArray(item.content)) continue;

			let patchedContent: unknown[] | undefined;
			for (let contentIndex = 0; contentIndex < item.content.length; contentIndex++) {
				const part = item.content[contentIndex];
				if (!part || typeof part !== "object" || part.type !== "output_text" || part.logprobs != null) continue;

				patchedContent ??= item.content.slice();
				patchedContent[contentIndex] = { ...part, logprobs: [] };
			}

			if (patchedContent) {
				patchedInput ??= payload.input.slice();
				patchedInput[inputIndex] = { ...item, content: patchedContent };
			}
		}

		return patchedInput ? { ...payload, input: patchedInput } : undefined;
	});
}
