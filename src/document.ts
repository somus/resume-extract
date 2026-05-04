import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PdfTextExtractionOptions, ResumeDocumentInput } from "./types";

async function loadKreuzberg() {
	try {
		return await import("@kreuzberg/node");
	} catch (error) {
		throw new Error(
			"Document parsing requires @kreuzberg/node. Install dependency or use parseResume() with pre-extracted text.",
			{ cause: error },
		);
	}
}

async function withDocumentPath<T>(
	input: ResumeDocumentInput,
	extension: "pdf" | "docx",
	run: (filePath: string) => T | Promise<T>,
): Promise<T> {
	if (typeof input === "string") return await run(input);

	const tempPath = join(tmpdir(), `resume-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
	writeFileSync(tempPath, input);

	try {
		return await run(tempPath);
	} finally {
		try {
			unlinkSync(tempPath);
		} catch {
			// Ignore temp cleanup failures.
		}
	}
}

function buildPdfExtractOptions(options?: PdfTextExtractionOptions) {
	if (!options?.ocr) return undefined;
	const ocr = options.ocr === true ? {} : options.ocr;
	return {
		ocr: {
			backend: ocr.backend || "tesseract",
			language: ocr.language || "eng",
			dpi: ocr.dpi || 150,
		},
	};
}

async function extractTextFromDocument(
	input: ResumeDocumentInput,
	format: "pdf" | "docx",
	pdfOptions?: PdfTextExtractionOptions,
): Promise<string> {
	const { extractFileSync } = await loadKreuzberg();
	const extractOptions = format === "pdf" ? buildPdfExtractOptions(pdfOptions) : undefined;
	const label = format.toUpperCase();

	return await withDocumentPath(input, format, (filePath) => {
		const result = extractFileSync(filePath, null, extractOptions);
		if (!result.content || result.content.trim().length === 0) {
			throw new Error(`Could not extract text from ${label} - file may be empty or unreadable`);
		}
		return result.content;
	});
}

export async function extractTextFromPdf(
	input: ResumeDocumentInput,
	options?: PdfTextExtractionOptions,
): Promise<string> {
	return await extractTextFromDocument(input, "pdf", options);
}

export async function extractTextFromDocx(input: ResumeDocumentInput): Promise<string> {
	return await extractTextFromDocument(input, "docx");
}
