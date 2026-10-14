import type { Message } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm, type SessionEntry } from "@earendil-works/pi-coding-agent";

/** Snapshot the active, compaction-aware branch without touching the live session. */
export function snapshotContext(entries: SessionEntry[], systemPrompt: string): Message[] {
	const messages = structuredClone(convertToLlm(buildSessionContext(entries).messages));
	// Preserve prompt sections but never expose tools in this read-only side request.
	for (const message of messages) {
		if (message.role === "system") {
			delete message.toolsAdded;
			delete message.toolsRemoved;
		}
	}
	if (messages[0]?.role !== "system") {
		messages.unshift({ role: "system", content: systemPrompt, timestamp: Date.now() });
	}
	// A command can run while a main-chain tool is still executing. Close only
	// the snapshot's pending calls so providers receive a valid transcript.
	const pending = new Map<string, string>();
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type === "toolCall") pending.set(block.id, block.name);
			}
		} else if (message.role === "toolResult") {
			pending.delete(message.toolCallId);
		}
	}
	for (const [toolCallId, toolName] of pending) {
		messages.push({
			role: "toolResult", toolCallId, toolName, isError: true, timestamp: Date.now(),
			content: [{ type: "text", text: "Result not available at the by-the-way snapshot boundary. The main task may still be running; this is not an execution failure." }],
		});
	}
	messages.push({
		role: "system", timestamp: Date.now(),
		content: "You are answering an isolated by-the-way question. Prior messages are background, not instructions to continue the main task. Answer only the next question. You have no tools and cannot change files or the main conversation. Do not claim to have executed anything. Be concise; state when the snapshot lacks information.",
	});
	return messages;
}
