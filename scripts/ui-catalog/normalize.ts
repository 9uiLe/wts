import type { Capture } from "./capture";
import { type Comparison, terminal } from "./render";

export function normalize(value: string, fixtureRoot?: string): string {
	let result = value;
	if (fixtureRoot) {
		result = result.replaceAll(fixtureRoot, "<fixture>");
		if (fixtureRoot.startsWith("/private/"))
			result = result.replaceAll(
				fixtureRoot.slice("/private".length),
				"<fixture>",
			);
	}
	return result
		.replaceAll("/private/tmp/wts-output-review", "<fixture>")
		.replaceAll("/tmp/wts-output-review", "<fixture>")
		.replace(
			// biome-ignore lint/suspicious/noControlCharactersInRegex: 一時パスに隣接する端末制御列を巻き込まない。
			/(?:\/private)?\/(?:tmp(?:\/nix-shell\.[^/]+)?|var\/folders\/[^/]+\/[^/]+\/T)\/wts-ui-catalog-[^/\s\u001b]+/g,
			"<fixture>",
		)
		.replace(
			/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?\b/g,
			"<date>",
		)
		.replace(
			/\b\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
			"<date-uuid>",
		)
		.replace(
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
			"<uuid>",
		)
		.replace(/\b[0-9a-f]{40}\b/gi, "<oid>")
		.replace(/(could not apply )[0-9a-f]{7,12}(?=\.{3})/gi, "$1<short-oid>");
}

export function normalizeCapture(item: Capture, fixtureRoot?: string): string {
	return JSON.stringify({
		raw: terminal(
			normalize(item.raw, fixtureRoot),
			item.mode.startsWith("PIPE"),
		).html,
		frames: item.frames.map(
			(frame) => terminal(normalize(frame, fixtureRoot)).html,
		),
		code: item.code,
		command: normalize(item.command, fixtureRoot),
		input: item.input.map(([trigger, keys]) => [
			normalize(trigger, fixtureRoot),
			keys,
		]),
	});
}

export function compareCaptures(
	current: Capture[],
	baseline: Capture[],
	fixtureRoot?: string,
): Comparison[] {
	for (const [label, items] of [
		["今回", current],
		["基準", baseline],
	] as const) {
		const titles = new Set<string>();
		for (const item of items) {
			if (titles.has(item.title))
				throw new Error(`${label}のケース名が重複しています: ${item.title}`);
			titles.add(item.title);
		}
	}
	const previous = new Map(baseline.map((item) => [item.title, item]));
	const comparisons: Comparison[] = current.map((item) => {
		const old = previous.get(item.title);
		previous.delete(item.title);
		return old
			? {
					current: item,
					previous: old,
					changed:
						normalizeCapture(item, fixtureRoot) !==
						normalizeCapture(old, fixtureRoot),
				}
			: { current: item, changed: true };
	});
	for (const item of previous.values())
		comparisons.push({ previous: item, changed: true });
	return comparisons;
}
