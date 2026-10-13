import { isAbsolute, relative, resolve, sep } from "node:path";
import { readStoredCredential, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const BASE_LIMIT_URL = "https://ai.adityagupta.dev/providers";

type Window = { remaining_percent?: number };
type Pool = { five_hour?: Window; weekly?: Window };

interface QuotaSource {
	credId: string;
	url: string;
	headers: (key: string) => Record<string, string>;
	pickPool: (data: any, haystack: string) => Pool | undefined;
}

const SOURCES: Record<string, QuotaSource> = {
	antigravity: {
		credId: "antigravity",
		url: `${BASE_LIMIT_URL}/antigravity/status/limit`,
		headers: (key) => ({ "x-goog-api-key": key }),
		pickPool: (data, haystack) => {
			if (Array.isArray(data?.buckets)) {
				const isGemini = haystack.includes("gemini");
				const pool: Pool = {};
				for (const b of data.buckets) {
					const id = String(b?.id || "").toLowerCase();
					const group = String(b?.pool_display_name || "").toLowerCase();
					const matchesGroup = isGemini
						? id.startsWith("gemini") || group.includes("gemini")
						: id.startsWith("3p") || group.includes("claude") || group.includes("gpt");

					if (!matchesGroup) continue;

					const pct =
						b?.remaining_fraction != null
							? b.remaining_fraction * 100
							: b?.remaining_percent;
					if (pct == null) continue;

					const win = String(b?.window || b?.id || "").toLowerCase();
					if (win.includes("5h") || win.includes("five_hour")) {
						pool.five_hour = { remaining_percent: pct };
					} else if (win.includes("week")) {
						pool.weekly = { remaining_percent: pct };
					}
				}
				return pool;
			}
			const poolName = haystack.includes("gemini") ? "gemini" : "third_party";
			return data?.pools?.[poolName];
		},
	},
	codex: {
		credId: "codex",
		url: `${BASE_LIMIT_URL}/codex/status/limit`,
		headers: (key) => ({ Authorization: `Bearer ${key}` }),
		pickPool: (data) =>
			data?.pools?.codex ?? (data?.pools ? (Object.values(data.pools)[0] as Pool) : undefined),
	},
};

const quotaCache = new Map<string, any>();
const inflight = new Set<string>();

function findSource(model?: { id?: string; name?: string; provider?: string }) {
	const haystack = `${model?.provider || ""} ${model?.id || ""} ${model?.name || ""}`.toLowerCase();
	const key = Object.keys(SOURCES).find((name) => haystack.includes(name));
	return key ? { key, source: SOURCES[key], haystack } : undefined;
}

async function fetchQuota(key: string, source: QuotaSource, onDone?: () => void) {
	if (inflight.has(key)) return;
	const cred = readStoredCredential(source.credId);
	const apiKey = cred?.type === "api_key" ? cred.key : undefined;
	if (!apiKey) return;

	inflight.add(key);
	try {
		const res = await fetch(source.url, {
			headers: source.headers(apiKey),
		});
		if (res.ok) {
			quotaCache.set(key, await res.json());
			onDone?.();
		}
	} catch {
		// ignore network errors
	} finally {
		inflight.delete(key);
	}
}

function formatPercent(pct: number | undefined): string {
	if (pct == null) return "?";
	return pct >= 100 ? "100%" : `${pct.toFixed(1)}%`;
}

function getLimitColor(pct: number): "success" | "warning" | "error" {
	if (pct >= 60) return "success";
	if (pct >= 20) return "warning";
	return "error";
}

function renderBlockBar(pct: number, width = 7): string {
	const eighths = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width * 8);
	const full = Math.floor(eighths / 8);
	const frac = eighths % 8;
	const chars = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
	const bar = "█".repeat(full) + (full < width ? chars[frac] : "");
	return bar.padEnd(width, "░");
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home?: string): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

const WINDOWS = [
	["five_hour", "5h"],
	["weekly", "W"],
] as const;

function renderPool(theme: any, pool?: Pool): string[] {
	return WINDOWS.flatMap(([key, label]) => {
		const pct = pool?.[key]?.remaining_percent;
		if (pct == null) return [];
		const value = `${renderBlockBar(pct)} ${formatPercent(pct)}`;
		return [`${theme.fg("dim", `${label}: `)}${theme.fg(getLimitColor(pct), value)}`];
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const updateQuota = () => {
				const active = findSource(ctx.model);
				if (active) {
					fetchQuota(active.key, active.source, () => tui.requestRender());
				}
			};

			updateQuota();

			const refresh = () => {
				updateQuota();
				tui.requestRender();
			};

			const unsubs = [
				footerData.onBranchChange(() => tui.requestRender()),
				pi.on("model_select", refresh),
				pi.on("thinking_level_select", () => tui.requestRender()),
				pi.on("turn_end", refresh),
			];

			return {
				dispose() {
					for (const unsub of unsubs) {
						unsub();
					}
				},
				invalidate() {},
				render(width: number): string[] {
					const parts: string[] = [];

					// 1. Directory
					const cwd = formatCwdForFooter(ctx.cwd, process.env.HOME || process.env.USERPROFILE);
					parts.push(theme.fg("dim", cwd));

					// 2. Git branch (if applicable)
					const branch = footerData.getGitBranch();
					if (branch) {
						parts.push(theme.fg("dim", `(${branch})`));
					}

					// 3. Context usage
					const contextUsage = ctx.getContextUsage();
					const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const percent = contextUsage?.percent;
					if (contextWindow > 0) {
						parts.push(theme.fg("dim", `${formatPercent(percent)}/${formatTokens(contextWindow)}`));
					} else if (percent != null) {
						parts.push(theme.fg("dim", formatPercent(percent)));
					}

					// 4. Model
					const modelName = ctx.model?.name || ctx.model?.id || "no-model";
					parts.push(theme.fg("dim", modelName));

					// 5. Reasoning level
					if (ctx.model?.reasoning) {
						const thinkingLevel = ctx.thinkingLevel || pi.getThinkingLevel() || "off";
						parts.push(theme.getThinkingBorderColor(thinkingLevel)(thinkingLevel));
					}

					// 6. Model limits (for Antigravity and Codex models)
					const active = findSource(ctx.model);
					if (active) {
						const data = quotaCache.get(active.key);
						const pool = active.source.pickPool(data, active.haystack);
						parts.push(...renderPool(theme, pool));
					}

					// Join items with a separator and dim styling
					const sepStr = theme.fg("dim", " • ");
					const styledLine = parts.join(sepStr);

					return [truncateToWidth(styledLine, width, theme.fg("dim", "..."))];
				},
			};
		});
	});
}
