import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { extractTextFromDocx, extractTextFromPdf } from "./document";

describe("document extraction", () => {
	afterEach(() => {
		mock.restore();
	});

	test("passes OCR defaults for PDF extraction and cleans up temp files", async () => {
		let seenPath = "";
		let seenOptions: unknown;

		mock.module("@kreuzberg/node", () => ({
			extractFileSync: (filePath: string, _unused: null, options: unknown) => {
				seenPath = filePath;
				seenOptions = options;
				expect(existsSync(filePath)).toBe(true);
				return { content: "pdf text" };
			},
		}));

		const text = await extractTextFromPdf(new Uint8Array([1, 2, 3]), { ocr: true });

		expect(text).toBe("pdf text");
		expect(seenPath.endsWith(".pdf")).toBe(true);
		expect(seenOptions).toEqual({
			ocr: {
				backend: "tesseract",
				language: "eng",
				dpi: 150,
			},
		});
		expect(existsSync(seenPath)).toBe(false);
	});

	test("throws when extracted DOCX text is empty", async () => {
		mock.module("@kreuzberg/node", () => ({
			extractFileSync: () => ({ content: "   " }),
		}));

		await expect(extractTextFromDocx("/tmp/resume.docx")).rejects.toThrow(/Could not extract text from DOCX/);
	});
});
