import { describe, expect, test } from "bun:test";
import { chunkText } from "./chunking";

function fakeTokenizer(charsPerToken: number) {
	return {
		encode(text: string) {
			return new Array(Math.ceil(text.length / charsPerToken));
		},
	} as any;
}

describe("chunkText", () => {
	test("returns single chunk when text fits within 512 tokens", () => {
		const text = "Short resume text.\n\nEducation section.";
		const chunks = chunkText(text, fakeTokenizer(1000));
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toEqual({ text, offset: 0 });
	});

	test("returns single chunk when tokenizer is null", () => {
		const text = "Any text regardless of length ".repeat(100);
		const chunks = chunkText(text, null);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toEqual({ text, offset: 0 });
	});

	test("splits at paragraph boundaries for long text", () => {
		const section1 = "A".repeat(300);
		const section2 = "B".repeat(300);
		const section3 = "C".repeat(300);
		const text = `${section1}\n\n${section2}\n\n${section3}`;
		// 1 char = 1 token, so each section is 300 tokens > needs splitting
		const chunks = chunkText(text, fakeTokenizer(1));
		expect(chunks.length).toBeGreaterThan(1);
	});

	test("offsets map back to original text positions", () => {
		const section1 = "First section content";
		const section2 = "Second section content";
		const section3 = "Third section content";
		const text = `${section1}\n\n${section2}\n\n${section3}`;
		// Make each section ~20 tokens with 1 char/token, total ~66 > 512 won't split
		// Use very small chars-per-token so total exceeds 512
		const chunks = chunkText(text, fakeTokenizer(0.1));
		for (const chunk of chunks) {
			expect(text.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text);
		}
	});

	test("greedy grouping keeps sections together when they fit", () => {
		const sections = Array.from({ length: 10 }, (_, i) => `Section ${i}: ${"x".repeat(40)}`);
		const text = sections.join("\n\n");
		// 4 chars per token → each section ~12 tokens, total ~120 tokens → fits in one chunk
		const chunks = chunkText(text, fakeTokenizer(4));
		expect(chunks).toHaveLength(1);
	});

	test("splits oversized single section at sentence boundaries", () => {
		const sentences = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} with some padding text.`);
		const text = sentences.join(" ");
		// 1 char = 1 token, total ~800 tokens in a single paragraph (no \n\n)
		const chunks = chunkText(text, fakeTokenizer(1));
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.text.length).toBeLessThanOrEqual(512);
		}
	});

	test("oversized section chunks have correct offsets", () => {
		const sentences = Array.from({ length: 20 }, (_, i) => `Sentence ${i} here.`);
		const text = sentences.join(" ");
		const chunks = chunkText(text, fakeTokenizer(1));
		for (const chunk of chunks) {
			expect(text.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text);
		}
	});
});
