import { isAbsolute, relative, resolve, sep } from "node:path";
import { readStoredCredential, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const LIMIT_URL = "https://ai.adityagupta.dev/providers/antigravity/status/limit";

let quotaData: any = null;
let fetching = false;

async function fetchLimits(onDone?: () => void) {
	if (fetching) return;
	const cred = readStoredCredential("antigravity");
	const apiKey = cred?.type === "api_key" ? cred.key : undefined;
	if (!apiKey) return;
	fetching = true;
	try {
		const res = await fetch(LIMIT_URL, {
			headers: { "x-goog-api-key": apiKey },
		});
		if (res.ok) {
			quotaData = await res.json();
			onDone?.();
		}
	} catch {
		// ignore network errors
	} finally {
		fetching = false;
	}
}

function getPoolForModel(modelId?: string, modelName?: string): "gemini" | "third_party" | null {
	const lower = `${modelId || ""} ${modelName || ""}`.toLowerCase();
	if (!lower.includes("antigravity")) return null;
	if (lower.includes("gemini")) return "gemini";
	return "third_party";
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

function renderBlockBar(pct: number): string {
	const chars = ["░", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
	const val = (Math.max(0, Math.min(100, pct)) / 100) * 7;
	const full = Math.floor(val);
	const rem = val - full;
	const frac = Math.round(rem * 8);
	let res = "█".repeat(full);
	if (full < 7) {
		if (frac === 8) {
			res += "█";
			res += "░".repeat(7 - full - 1);
		} else if (frac > 0) {
			res += chars[frac];
			res += "░".repeat(7 - full - 1);
		} else {
			res += "░".repeat(7 - full);
		}
	}
	return res;
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

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			const updateQuota = () => {
				if (getPoolForModel(ctx.model?.id, ctx.model?.name)) {
					fetchLimits(() => tui.requestRender());
				}
			};

			updateQuota();

			const unsubs = [
				unsubBranch,
				pi.on("model_select", () => {
					updateQuota();
					tui.requestRender();
				}),
				pi.on("thinking_level_select", () => tui.requestRender()),
				pi.on("turn_end", () => {
					updateQuota();
					tui.requestRender();
				}),
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
					let contextStr = "";
					if (contextWindow > 0) {
						const pctStr = percent != null ? `${percent.toFixed(1)}%` : "?";
						contextStr = `${pctStr}/${formatTokens(contextWindow)}`;
					} else if (percent != null) {
						contextStr = `${percent.toFixed(1)}%`;
					}
					if (contextStr) {
						parts.push(theme.fg("dim", contextStr));
					}

					// 4. Model
					const modelName = ctx.model?.name || ctx.model?.id || "no-model";
					parts.push(theme.fg("dim", modelName));

					// 5. Reasoning level
					if (ctx.model?.reasoning) {
						const thinkingLevel = ctx.thinkingLevel || pi.getThinkingLevel() || "off";
						parts.push(theme.getThinkingBorderColor(thinkingLevel)(thinkingLevel));
					}

					// 6. Model limits (for Antigravity models)
					const poolName = getPoolForModel(ctx.model?.id, ctx.model?.name);
					if (poolName && quotaData?.pools?.[poolName]) {
						const pool = quotaData.pools[poolName];
						if (pool.five_hour?.remaining_percent != null) {
							const pct = pool.five_hour.remaining_percent;
							const color = getLimitColor(pct);
							parts.push(`${theme.fg("dim", "5h: ")}${theme.fg(color, `${renderBlockBar(pct)} ${formatPercent(pct)}`)}`);
						}
						if (pool.weekly?.remaining_percent != null) {
							const pct = pool.weekly.remaining_percent;
							const color = getLimitColor(pct);
							parts.push(`${theme.fg("dim", "weekly: ")}${theme.fg(color, `${renderBlockBar(pct)} ${formatPercent(pct)}`)}`);
						}
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
