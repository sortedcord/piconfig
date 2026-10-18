import type { ExtensionAPI, ExtensionCommandContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

export const CUSTOM_OPTION_LABEL = "Other (type custom answer)...";

// Schema for individual option
const OptionSchema = Type.Union([
	Type.String({ description: "Option text" }),
	Type.Object({
		label: Type.String({ description: "Display label for the option" }),
		value: Type.Optional(Type.String({ description: "Underlying value returned if selected (defaults to label)" })),
		description: Type.Optional(Type.String({ description: "Optional description explaining this option" })),
	}),
]);

// Schema for tool parameters
export const AskUserParams = Type.Object({
	question: Type.String({
		description: "The question or prompt to present to the user.",
	}),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			description:
				"Optional list of choices for multiple-choice option select. If omitted or empty, the user is prompted for a free-form text answer.",
		}),
	),
	allow_custom: Type.Optional(
		Type.Boolean({
			description:
				"When options are provided, whether to include an 'Other (type custom answer)...' option allowing the user to provide their own response. Defaults to true.",
		}),
	),
	multiline: Type.Optional(
		Type.Boolean({
			description:
				"For text answers, whether to open a multi-line editor instead of a single-line input field. Defaults to false.",
		}),
	),
	placeholder: Type.Optional(
		Type.String({
			description: "Optional placeholder or prefilled text for text input.",
		}),
	),
	type: Type.Optional(
		Type.Union(
			[Type.Literal("select"), Type.Literal("text"), Type.Literal("editor"), Type.Literal("confirm")],
			{
				description:
					"Optional explicit interaction mode ('select', 'text', 'editor', 'confirm'). Inferred automatically if omitted.",
			},
		),
	),
});

export type AskUserParamsType = Static<typeof AskUserParams>;

export const AskUserOutput = Type.Object({
	question: Type.String(),
	answer: Type.Union([Type.String(), Type.Null()]),
	cancelled: Type.Boolean(),
	was_custom: Type.Boolean(),
	selected_option: Type.Optional(Type.String()),
	confirmed: Type.Optional(Type.Boolean()),
});

export type AskUserOutputType = Static<typeof AskUserOutput>;

export interface NormalizedOption {
	label: string;
	value: string;
	description?: string;
	displayText: string;
}

export function normalizeOptions(
	rawOptions?: Array<string | { label: string; value?: string; description?: string }>,
): NormalizedOption[] {
	if (!rawOptions || rawOptions.length === 0) return [];
	return rawOptions.map((opt) => {
		if (typeof opt === "string") {
			return { label: opt, value: opt, displayText: opt };
		}
		const label = opt.label ?? String(opt);
		const value = opt.value ?? label;
		const description = opt.description ? ` — ${opt.description}` : "";
		return {
			label,
			value,
			description: opt.description,
			displayText: `${label}${description}`,
		};
	});
}

export interface AskUserContext {
	ui: ExtensionToolContext["ui"];
	hasUI: boolean;
}

export async function handleAskUser(
	params: AskUserParamsType,
	signal: AbortSignal | undefined,
	ctx: AskUserContext,
) {
	if (!ctx.hasUI) {
		return {
			content: [{ type: "text" as const, text: "Error: Interactive UI is not available in non-interactive mode." }],
			isError: true,
			details: {
				question: params.question,
				error: "no_ui",
				cancelled: true,
				answer: null,
				was_custom: false,
			},
			structuredContent: {
				question: params.question,
				answer: null,
				cancelled: true,
				was_custom: false,
			},
		};
	}

	const rawOptions = params.options;
	const normalized = normalizeOptions(rawOptions);
	const allowCustom = params.allow_custom !== false;
	const isMultiline = params.multiline === true || params.type === "editor";
	const explicitType = params.type;

	// Confirmation mode: Yes / No dialog
	if (explicitType === "confirm") {
		const confirmed = await ctx.ui.confirm(params.question, params.placeholder ?? "", { signal });
		const answerStr = confirmed ? "yes" : "no";
		return {
			content: [{ type: "text" as const, text: `User responded: ${confirmed ? "Yes" : "No"}` }],
			details: {
				question: params.question,
				answer: answerStr,
				confirmed,
				cancelled: false,
				was_custom: false,
			},
			structuredContent: {
				question: params.question,
				answer: answerStr,
				confirmed,
				cancelled: false,
				was_custom: false,
			},
		};
	}

	// Option select mode
	const shouldSelect = explicitType === "select" || (!explicitType && normalized.length > 0);

	if (shouldSelect && normalized.length > 0) {
		const displayChoices = normalized.map((n) => n.displayText);
		if (allowCustom) {
			displayChoices.push(CUSTOM_OPTION_LABEL);
		}

		while (true) {
			if (signal?.aborted) {
				return {
					content: [{ type: "text" as const, text: "Question prompt was aborted." }],
					details: { question: params.question, cancelled: true, answer: null, was_custom: false },
					structuredContent: { question: params.question, answer: null, cancelled: true, was_custom: false },
				};
			}

			const choice = await ctx.ui.select(params.question, displayChoices, { signal });

			if (choice === undefined) {
				// User cancelled with Escape
				return {
					content: [{ type: "text" as const, text: "User cancelled the question prompt without answering." }],
					details: { question: params.question, cancelled: true, answer: null, was_custom: false },
					structuredContent: { question: params.question, answer: null, cancelled: true, was_custom: false },
				};
			}

			if (choice === CUSTOM_OPTION_LABEL) {
				// User chose to type a custom answer
				const customAnswer = isMultiline
					? await ctx.ui.editor(params.question, params.placeholder)
					: await ctx.ui.input(params.question, params.placeholder ?? "Type your answer...", { signal });

				if (customAnswer === undefined) {
					// Escape in custom input returns to the options menu
					continue;
				}

				const trimmed = customAnswer.trim();
				if (trimmed.length === 0) {
					// Empty submission returns to the options menu
					continue;
				}

				return {
					content: [{ type: "text" as const, text: `User typed: ${trimmed}` }],
					details: {
						question: params.question,
						answer: trimmed,
						cancelled: false,
						was_custom: true,
					},
					structuredContent: {
						question: params.question,
						answer: trimmed,
						cancelled: false,
						was_custom: true,
					},
				};
			}

			// Predefined option selected
			const matched = normalized.find((n) => n.displayText === choice || n.label === choice);
			const answerVal = matched ? matched.value : choice;
			const answerLabel = matched ? matched.label : choice;

			return {
				content: [{ type: "text" as const, text: `User selected: ${answerLabel}` }],
				details: {
					question: params.question,
					answer: answerVal,
					selected_option: answerLabel,
					cancelled: false,
					was_custom: false,
				},
				structuredContent: {
					question: params.question,
					answer: answerVal,
					selected_option: answerLabel,
					cancelled: false,
					was_custom: false,
				},
			};
		}
	}

	// Free-form text input mode (no options or explicit text/editor mode)
	if (isMultiline) {
		const customAnswer = await ctx.ui.editor(params.question, params.placeholder);
		if (customAnswer === undefined) {
			return {
				content: [{ type: "text" as const, text: "User cancelled the text prompt without answering." }],
				details: { question: params.question, cancelled: true, answer: null, was_custom: true },
				structuredContent: { question: params.question, answer: null, cancelled: true, was_custom: true },
			};
		}
		const trimmed = customAnswer.trim();
		return {
			content: [{ type: "text" as const, text: `User answered:\n${trimmed}` }],
			details: {
				question: params.question,
				answer: trimmed,
				cancelled: false,
				was_custom: true,
			},
			structuredContent: {
				question: params.question,
				answer: trimmed,
				cancelled: false,
				was_custom: true,
			},
		};
	} else {
		const customAnswer = await ctx.ui.input(params.question, params.placeholder ?? "Type your answer...", { signal });
		if (customAnswer === undefined) {
			return {
				content: [{ type: "text" as const, text: "User cancelled the text prompt without answering." }],
				details: { question: params.question, cancelled: true, answer: null, was_custom: true },
				structuredContent: { question: params.question, answer: null, cancelled: true, was_custom: true },
			};
		}
		const trimmed = customAnswer.trim();
		return {
			content: [{ type: "text" as const, text: `User answered: ${trimmed}` }],
			details: {
				question: params.question,
				answer: trimmed,
				cancelled: false,
				was_custom: true,
			},
			structuredContent: {
				question: params.question,
				answer: trimmed,
				cancelled: false,
				was_custom: true,
			},
		};
	}
}

export default function askUserExtension(pi: ExtensionAPI): void {
	// Register the ask_user tool for LLM agent calls
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user a question to get clarification, confirmation, choices, or input at any time. Supports multiple-choice options, yes/no confirmation, or free-form text answers.",
		promptSnippet: "Ask the user a question with selectable options or free-form text input",
		promptGuidelines: [
			"Use `ask_user` whenever you need clarification, user preferences, confirmations, or decisions to proceed.",
			"When you have specific discrete choices, provide them in the `options` array so the user can easily select one.",
			"When asking open-ended questions, omit `options` to allow the user to type a free-form text answer.",
			"Use `multiline: true` when asking for longer text answers like code snippets, descriptions, or configuration.",
		],
		parameters: AskUserParams,
		outputSchema: AskUserOutput,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return handleAskUser(params, signal, ctx);
		},

		renderCall(args: AskUserParamsType, theme) {
			let title = theme.fg("toolTitle", theme.bold("ask_user ")) + theme.fg("muted", args.question);
			if (args.type === "confirm") {
				title += `\n${theme.fg("dim", "  [Confirmation: Yes/No]")}`;
			} else if (args.options && Array.isArray(args.options) && args.options.length > 0) {
				const labels = args.options.map((o) => (typeof o === "string" ? o : o.label));
				const preview = args.allow_custom !== false ? [...labels, "Other..."] : labels;
				title += `\n${theme.fg("dim", `  Options: ${preview.join(" | ")}`)}`;
			} else if (args.multiline || args.type === "editor") {
				title += `\n${theme.fg("dim", "  [Multi-line text editor]")}`;
			} else {
				title += `\n${theme.fg("dim", "  [Free-form text input]")}`;
			}
			return new Text(title, 0, 0);
		},

		renderResult(result, _options, theme) {
			if (result.isError) {
				const errorMsg = result.content[0]?.type === "text" ? result.content[0].text : "Error";
				return new Text(theme.fg("error", `✗ ${errorMsg}`), 0, 0);
			}
			const details = result.details as AskUserOutputType | undefined;
			if (!details || details.cancelled || details.answer === null) {
				return new Text(theme.fg("warning", "⊘ Cancelled / No answer"), 0, 0);
			}
			const customTag = details.was_custom ? theme.fg("dim", "(typed) ") : "";
			return new Text(`${theme.fg("success", "✓ ")}${customTag}${theme.fg("accent", String(details.answer))}`, 0, 0);
		},
	});

	// Register /ask command for interactive testing and manual usage
	pi.registerCommand("ask", {
		description: "Ask a question (interactive options or text answer prompt)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const questionText = args.trim() || (await ctx.ui.input("Question to ask:"));
			if (!questionText) {
				ctx.ui.notify("No question provided", "warning");
				return;
			}

			const modeChoice = await ctx.ui.select("Question type:", [
				"Text answer (single-line)",
				"Text answer (multi-line editor)",
				"Option select (with custom option)",
				"Yes / No confirmation",
			]);
			if (!modeChoice) return;

			if (modeChoice.startsWith("Text answer (single-line)")) {
				const ans = await ctx.ui.input(questionText);
				if (ans !== undefined) ctx.ui.notify(`Answer: ${ans}`, "info");
				else ctx.ui.notify("Cancelled", "warning");
			} else if (modeChoice.startsWith("Text answer (multi-line")) {
				const ans = await ctx.ui.editor(questionText);
				if (ans !== undefined) ctx.ui.notify(`Answer: ${ans}`, "info");
				else ctx.ui.notify("Cancelled", "warning");
			} else if (modeChoice.startsWith("Yes / No")) {
				const confirmed = await ctx.ui.confirm(questionText, "");
				ctx.ui.notify(`Answer: ${confirmed ? "Yes" : "No"}`, "info");
			} else {
				const rawOpts = await ctx.ui.input("Enter options (comma-separated):", "e.g. Red, Green, Blue");
				const options = rawOpts
					? rawOpts
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: ["Option A", "Option B"];
				const result = await handleAskUser({ question: questionText, options }, ctx.signal, ctx);
				const answer = (result.details as AskUserOutputType | undefined)?.answer;
				if (answer) ctx.ui.notify(`Answer: ${answer}`, "info");
				else ctx.ui.notify("Cancelled", "warning");
			}
		},
	});
}
