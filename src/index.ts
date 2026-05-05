import { computeATSScore } from "./ats";
import { chunkText } from "./chunking";
import { extractTextFromDocx, extractTextFromPdf } from "./document";
import { groupIntoEntries } from "./grouping";
import { computeYears, inferCountry, inferSeniority } from "./inference";
import { applyPostProcessing, cleanEntity, mergeSubwords } from "./postprocess";
import { preprocessResumeText } from "./preprocess";
import { loadRuntime } from "./runtime";
import { fillMissingEntities } from "./section-detection";
import { cleanSpaces } from "./strings";
import type { NERToken, ParsedResume, PdfTextExtractionOptions, ResumeDocumentInput, Span } from "./types";

export type {
	ATSCategoryDetail,
	ATSIssue,
	ATSResult,
	Education,
	Experience,
	ParsedResume,
	PdfTextExtractionOptions,
	Personal,
	ResumeDocumentInput,
} from "./types";

export { computeATSScore, extractTextFromDocx, extractTextFromPdf };

export async function parseResume(text: string, modelPath: string): Promise<ParsedResume> {
	const runtime = await loadRuntime(modelPath);
	const context = { config: runtime.config, companies: runtime.companies };
	const preprocessedText = preprocessResumeText(runtime.config, text);

	const chunks = chunkText(preprocessedText, runtime.tokenizer);
	let spans: Span[] = [];
	for (const chunk of chunks) {
		const chunkSpans = mergeSubwords((await runtime.pipeline(chunk.text)) as NERToken[]);
		for (const span of chunkSpans) {
			spans.push({ ...span, start: span.start + chunk.offset, end: span.end + chunk.offset });
		}
	}
	spans = spans
		.map((span) => ({ ...span, text: cleanEntity(context, span.label, span.text) || "" }))
		.filter((span) => span.text.length > 0);
	spans = applyPostProcessing(context, spans);
	spans = fillMissingEntities(preprocessedText, spans);

	const grouped = groupIntoEntries(context, spans);
	const years = computeYears(runtime.config, grouped.experiences);
	const seniority = inferSeniority(runtime.config, grouped.experiences, years);
	const country = inferCountry(runtime.config, grouped.personal.location, grouped.personal.phone);

	return {
		personal: {
			...grouped.personal,
			name: grouped.personal.name ? cleanSpaces(runtime.config, grouped.personal.name) : null,
		},
		experience: grouped.experiences,
		education: grouped.education,
		skills: grouped.skills.map((skill) => cleanSpaces(runtime.config, skill)),
		certifications: grouped.certifications,
		seniority,
		country,
		experience_years: years,
		_rawText: text,
	};
}

export async function parseResumePdf(
	input: ResumeDocumentInput,
	modelPath: string,
	options?: PdfTextExtractionOptions,
): Promise<ParsedResume> {
	const text = await extractTextFromPdf(input, options);
	return await parseResume(text, modelPath);
}

export async function parseResumeDocx(input: ResumeDocumentInput, modelPath: string): Promise<ParsedResume> {
	const text = await extractTextFromDocx(input);
	return await parseResume(text, modelPath);
}
