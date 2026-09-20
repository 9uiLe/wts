import type { Block } from "./hamio";

// hamio API v1 の文字列・block・項目・単発 JSON の資源上限。
const maxStringBytes = 4096;
const maxBlocks = 32;
const maxItems = 200;
const maxRequestBytes = 256 * 1024;
const requestBytes = jsonBytes({ apiVersion: 1, blocks: [] });
const detailBytes = jsonBytes({ kind: "key-value", items: [] });

function jsonBytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value));
}

export function* messageBlocks(
	text: string,
	level: Extract<Block, { kind: "message" }>["level"],
): Generator<Block> {
	let part = "";
	let bytes = 0;
	for (const character of text) {
		if (character === "\n") {
			yield { kind: "message", level, text: part };
			part = "";
			bytes = 0;
			continue;
		}
		const size = Buffer.byteLength(character);
		if (bytes + size > maxStringBytes) {
			yield { kind: "message", level, text: part };
			part = "";
			bytes = 0;
		}
		part += character;
		bytes += size;
	}
	yield { kind: "message", level, text: part };
}

export function* detailBlocks(
	rows: Iterable<readonly [string, string]>,
): Generator<Block> {
	let items: { label: string; value: string }[] = [];
	let bytes = requestBytes + detailBytes;
	for (const [label, value] of rows) {
		const item = { label, value };
		const size = jsonBytes(item);
		if (
			items.length &&
			(items.length === maxItems || bytes + 1 + size > maxRequestBytes)
		) {
			yield { kind: "key-value", items };
			items = [];
			bytes = requestBytes + detailBytes;
		}
		bytes += size + (items.length ? 1 : 0);
		items.push(item);
	}
	if (items.length) yield { kind: "key-value", items };
}

export function* renderRequests(blocks: Iterable<Block>): Generator<Block[]> {
	let request: Block[] = [];
	let bytes = requestBytes;
	for (const block of blocks) {
		const size = jsonBytes(block);
		if (
			request.length &&
			(request.length === maxBlocks || bytes + 1 + size > maxRequestBytes)
		) {
			yield request;
			request = [];
			bytes = requestBytes;
		}
		bytes += size + (request.length ? 1 : 0);
		request.push(block);
	}
	if (request.length) yield request;
}
