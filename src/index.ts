import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline, type TokenClassificationPipeline } from "@huggingface/transformers";

// Types
interface ResumeConfig {
	seniority_keywords: Record<string, string[]>;
	seniority_by_years: Record<string, number>;
	phone_country_prefixes: Record<string, string>;
	us_states: string[];
	city_country_map: Record<string, string>;
	credential_suffixes: string[];
	multi_word_skills: string[];
}

interface Personal {
	name: string | null;
	email: string | null;
	phone: string | null;
	location: string | null;
}

interface Experience {
	title?: string;
	company?: string;
	start_date?: string;
	end_date?: string;
}

interface Education {
	degree?: string;
	field?: string;
	institution?: string;
}

export interface ParsedResume {
	personal: Personal;
	experience: Experience[];
	education: Education[];
	skills: string[];
	certifications: string[];
	seniority: string;
	country: string | null;
	experience_years: number | null;
	_rawText: string;
}

export interface ATSIssue {
	severity: "high" | "medium" | "low";
	message: string;
}

export interface ATSCategoryDetail {
	score: number;
	max: number;
	[key: string]: unknown;
}

export interface ATSResult {
	score: number;
	details: Record<string, ATSCategoryDetail>;
	issues: ATSIssue[];
}

export type ResumeDocumentInput = Uint8Array | string;

interface PdfOCROptions {
	backend?: "tesseract";
	language?: string;
	dpi?: number;
}

export interface PdfTextExtractionOptions {
	ocr?: boolean | PdfOCROptions;
}

// State
let _pipeline: TokenClassificationPipeline | null = null;
let _config: ResumeConfig | null = null;
let _companies: Set<string> | null = null;
let _modelPath: string | null = null;

// ============================================================
// LOADING
// ============================================================

function getModelPath(): string {
	if (!_modelPath) throw new Error("Model not loaded. Call parseResume first.");
	return _modelPath;
}

function loadConfig(): ResumeConfig {
	if (_config) return _config;
	const configPath = join(getModelPath(), "resume_config.json");
	if (!existsSync(configPath)) throw new Error(`resume_config.json not found at ${configPath}`);
	_config = JSON.parse(readFileSync(configPath, "utf-8")) as ResumeConfig;
	return _config;
}

function loadCompanies(): Set<string> {
	if (_companies) return _companies;
	_companies = new Set<string>();
	const companiesPath = join(getModelPath(), "companies.json");
	if (existsSync(companiesPath)) {
		const data = JSON.parse(readFileSync(companiesPath, "utf-8")) as Record<string, string[]>;
		for (const cats of Object.values(data)) {
			for (const c of cats) _companies.add(c.toLowerCase());
		}
	}
	return _companies;
}

async function loadPipeline(modelPath: string): Promise<TokenClassificationPipeline> {
	if (_pipeline) return _pipeline;
	_modelPath = modelPath;
	const options: Record<string, unknown> = { quantized: true, local_files_only: true };
	_pipeline = (await pipeline("token-classification", modelPath, options)) as TokenClassificationPipeline;
	return _pipeline;
}

// ============================================================
// POST-PROCESSING
// ============================================================

interface Span {
	label: string;
	text: string;
	start: number;
	end: number;
	bio: string;
	score: number;
}

interface NERToken {
	entity_group?: string;
	entity?: string;
	word?: string;
	start?: number;
	end?: number;
	score?: number;
}

function mergeSubwords(results: NERToken[]): Span[] {
	const tokens: Span[] = [];
	for (const r of results) {
		const entity = r.entity_group || r.entity || "O";
		const word = r.word || "";
		const isSubword = word.startsWith("##");
		const cleanWord = isSubword ? word.slice(2) : word;
		const baseLabel = entity.replace(/^[BI]-/, "");

		if (isSubword && tokens.length > 0) {
			tokens[tokens.length - 1].text += cleanWord;
			tokens[tokens.length - 1].end = r.end || tokens[tokens.length - 1].end;
		} else {
			tokens.push({
				label: baseLabel === "O" ? "O" : baseLabel,
				bio: entity.startsWith("B-") ? "B" : entity.startsWith("I-") ? "I" : "O",
				text: cleanWord,
				start: r.start || 0,
				end: r.end || 0,
				score: r.score || 0,
			});
		}
	}

	const merged: Span[] = [];
	for (const t of tokens) {
		if (t.label === "O") continue;
		if (merged.length > 0 && merged[merged.length - 1].label === t.label && t.bio === "I") {
			merged[merged.length - 1].text += ` ${t.text}`;
			merged[merged.length - 1].end = t.end;
		} else {
			merged.push({ ...t });
		}
	}
	return merged;
}

function cleanEntity(label: string, raw: string): string | null {
	let cleaned = raw
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[,.;:|/\-\s]+|[,.;:|/\-\s]+$/g, "");
	if (!cleaned || (cleaned.length === 1 && !/[a-zA-Z]/.test(cleaned))) return null;
	if (/^[\W_]+$/.test(cleaned)) return null;

	if (label === "EMAIL") {
		cleaned = cleaned
			.replace(/ /g, "")
			.replace(/^(Esq\.|Dr\.|PhD|MD|PE)\s*/i, "")
			.replace(/^[^a-zA-Z0-9]+/, "");
		if (!cleaned.includes("@")) return null;
	} else if (label === "SKILL") {
		cleaned = cleaned.replace(/[,.]$/, "");
	} else if (label === "COMPANY") {
		cleaned = cleaned.replace(/,?\s+[A-Z]{2}$/, "").trim();
	} else if (label === "DATE") {
		cleaned = cleaned.replace(/^[| ]+|[| ]+$/g, "");
	}
	return cleaned.length > 1 ? cleaned : null;
}

function applyPostProcessing(spans: Span[]): Span[] {
	const companies = loadCompanies();
	const config = loadConfig();

	// Gazetteer: relabel TITLE that's a known company
	let result = spans.map((s) => {
		if (s.label === "TITLE" && companies.has(s.text.toLowerCase().trim())) {
			return { ...s, label: "COMPANY" };
		}
		return s;
	});

	// Strip trailing date words from company names
	const dateWords = new Set([
		"jan",
		"january",
		"feb",
		"february",
		"mar",
		"march",
		"apr",
		"april",
		"may",
		"jun",
		"june",
		"jul",
		"july",
		"aug",
		"august",
		"sep",
		"september",
		"oct",
		"october",
		"nov",
		"november",
		"dec",
		"december",
		"present",
		"current",
	]);
	result = result.map((s) => {
		if (s.label !== "COMPANY") return s;
		const words = s.text.split(/\s+/);
		while (
			words.length > 1 &&
			(dateWords.has(words[words.length - 1].toLowerCase()) || /^\d{4}$/.test(words[words.length - 1]))
		) {
			words.pop();
		}
		return { ...s, text: words.join(" ") };
	});

	// Split company from title
	result = result.flatMap((s) => {
		if (s.label !== "TITLE") return [s];
		const words = s.text.split(" ");
		for (let len = Math.min(3, words.length); len >= 1; len--) {
			const prefix = words.slice(0, len).join(" ");
			if (companies.has(prefix.toLowerCase())) {
				return [
					{ ...s, label: "COMPANY", text: prefix },
					{ ...s, label: "TITLE", text: words.slice(len).join(" ") },
				].filter((x) => x.text.length > 1);
			}
		}
		return [s];
	});

	// Merge multi-word skills
	const multiWord = new Set((config.multi_word_skills || []).map((s: string) => s.toLowerCase()));
	const merged: Span[] = [];
	for (let i = 0; i < result.length; i++) {
		if (result[i].label === "SKILL" && i + 1 < result.length && result[i + 1]?.label === "SKILL") {
			const combined = `${result[i].text} ${result[i + 1].text}`.replace(/[,.]$/, "");
			if (multiWord.has(combined.toLowerCase())) {
				merged.push({ ...result[i], text: combined, end: result[i + 1].end });
				i++;
				continue;
			}
		}
		merged.push(result[i]);
	}

	return merged;
}

// ============================================================
// GROUPING
// ============================================================

function groupIntoEntries(spans: Span[]) {
	const personal: Personal = { name: null, email: null, phone: null, location: null };
	for (const s of spans) {
		if (s.label === "NAME" && !personal.name) personal.name = s.text;
		else if (s.label === "EMAIL" && !personal.email) {
			const e = cleanEntity("EMAIL", s.text);
			if (e) personal.email = e;
		} else if (s.label === "PHONE" && !personal.phone) personal.phone = cleanPhone(s.text);
		else if (s.label === "LOCATION" && !personal.location) personal.location = cleanSpaces(s.text);
	}

	const expSpans = spans
		.filter((s) => ["TITLE", "COMPANY", "DATE"].includes(s.label))
		.sort((a, b) => a.start - b.start);
	const experiences: Experience[] = [];
	let cur: Experience = {};
	for (const s of expSpans) {
		if (s.label === "TITLE") {
			if (cur.title && (cur.company || cur.start_date)) {
				experiences.push(cur);
				cur = {};
			}
			cur.title = cleanSpaces(s.text);
		} else if (s.label === "COMPANY") {
			if (cur.company && (cur.title || cur.start_date)) {
				experiences.push(cur);
				cur = {};
			}
			cur.company = cleanSpaces(cleanEntity("COMPANY", s.text) || "");
		} else if (s.label === "DATE") {
			const d = s.text.replace(/^[| ]+|[| ]+$/g, "");
			if (!d) continue;

			// Fix merged dates like "2020 Present" or "January 2020 Present" → split into start + end
			const presentMatch = d.match(/^(.+?)\s+(Present|Current)$/i);
			if (presentMatch && !cur.start_date) {
				cur.start_date = presentMatch[1].trim();
				cur.end_date = presentMatch[2];
				continue;
			}

			// Fix "month" without year appearing as start, followed by "year end" — merge
			if (cur.start_date && !cur.end_date && /^[a-zA-Z]+$/.test(cur.start_date) && /^\d{4}/.test(d)) {
				// start_date is just a month ("January"), this date starts with a year — merge them
				const yearMatch = d.match(/^(\d{4})\s*(.*)/);
				if (yearMatch) {
					cur.start_date = `${cur.start_date} ${yearMatch[1]}`;
					if (yearMatch[2]) cur.end_date = yearMatch[2].trim();
					continue;
				}
			}

			if (cur.start_date && cur.end_date) {
				if (cur.title || cur.company) {
					experiences.push(cur);
					cur = {};
				}
			}
			if (!cur.start_date) cur.start_date = d;
			else if (!cur.end_date) cur.end_date = d;
		}
	}
	if (cur.title || cur.company) experiences.push(cur);

	const eduSpans = spans
		.filter((s) => ["DEGREE", "FIELD", "INSTITUTION"].includes(s.label))
		.sort((a, b) => a.start - b.start);
	const education: Education[] = [];
	let curEdu: Education = {};
	for (const s of eduSpans) {
		if (s.label === "DEGREE") {
			if (curEdu.degree) {
				education.push(curEdu);
				curEdu = {};
			}
			curEdu.degree = cleanSpaces(s.text);
		} else if (s.label === "FIELD") curEdu.field = cleanSpaces(s.text);
		else if (s.label === "INSTITUTION") {
			curEdu.institution = cleanSpaces(s.text).replace(/,?\s*\d{4}\s*$/, "");
			education.push(curEdu);
			curEdu = {};
		}
	}
	if (curEdu.degree || curEdu.institution) education.push(curEdu);

	const skills: string[] = [];
	const seen = new Set<string>();
	for (const s of spans) {
		if (s.label !== "SKILL") continue;
		for (const part of s.text.split(/,\s*/)) {
			const clean = cleanSpaces(part.trim().replace(/[,.]$/, ""));
			if (clean && clean.length > 1 && !seen.has(clean.toLowerCase())) {
				seen.add(clean.toLowerCase());
				skills.push(clean);
			}
		}
	}

	const certs = spans
		.filter((s) => s.label === "CERT")
		.map((s) => cleanSpaces(s.text.replace(/[,.]$/, "")))
		.filter((s) => s.length > 1);

	return { personal, experiences, education, skills, certifications: certs };
}

// ============================================================
// INFERENCE
// ============================================================

function inferSeniority(experiences: Experience[], years: number | null): string {
	const config = loadConfig();
	const kw = config.seniority_keywords;
	const titles = experiences.map((e) => (e.title || "").toLowerCase()).filter(Boolean);
	for (const [level, keywords] of Object.entries(kw)) {
		for (const title of titles) {
			for (const k of keywords) {
				if (title.includes(k)) return level;
			}
		}
	}
	if (years != null) {
		const b = config.seniority_by_years;
		if (years >= b.Staff) return "Staff";
		if (years >= b.Senior) return "Senior";
		if (years >= b.Mid) return "Mid";
		return "Junior";
	}
	if (experiences.length >= 4) return "Senior";
	if (experiences.length >= 2) return "Mid";
	return "Junior";
}

function inferCountry(location: string | null, phone: string | null): string | null {
	const config = loadConfig();
	if (phone) {
		const clean = phone.replace(/[\s\-()]/g, "");
		for (const [prefix, country] of Object.entries(config.phone_country_prefixes)) {
			if (clean.startsWith(prefix)) return country;
		}
	}
	if (location) {
		const loc = location.toLowerCase();
		if (loc.includes("india")) return "India";
		if (loc.includes("united states") || loc.includes("usa")) return "United States";
		if (loc.includes("united kingdom") || loc.includes("uk")) return "United Kingdom";
		for (const [city, country] of Object.entries(config.city_country_map)) {
			if (loc.includes(city)) return country;
		}
		const parts = loc.replace(/,/g, " ").split(/\s+/);
		for (const part of parts) {
			if (config.us_states.includes(part.toUpperCase())) return "United States";
		}
	}
	return null;
}

function computeYears(experiences: Experience[]): number | null {
	let totalMonths = 0;
	const now = new Date();
	for (const exp of experiences) {
		if (!exp.start_date) continue;
		const start = parseDate(exp.start_date);
		if (!start) continue;
		let end: Date;
		if (!exp.end_date || /present|current/i.test(exp.end_date)) end = now;
		else {
			const e = parseDate(exp.end_date);
			if (!e) continue;
			end = e;
		}
		const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
		if (months > 0 && months < 600) totalMonths += months;
	}
	return totalMonths > 0 ? Math.round(totalMonths / 12) : null;
}

function parseDate(text: string): Date | null {
	const months: Record<string, number> = {
		january: 0,
		february: 1,
		march: 2,
		april: 3,
		may: 4,
		june: 5,
		july: 6,
		august: 7,
		september: 8,
		october: 9,
		november: 10,
		december: 11,
		jan: 0,
		feb: 1,
		mar: 2,
		apr: 3,
		jun: 5,
		jul: 6,
		aug: 7,
		sep: 8,
		oct: 9,
		nov: 10,
		dec: 11,
	};
	const lower = text.toLowerCase().trim();
	for (const [name, num] of Object.entries(months)) {
		const m = lower.match(new RegExp(`${name}\\s+(\\d{4})`));
		if (m) return new Date(Number.parseInt(m[1], 10), num, 1);
	}
	const ym = text.match(/\b(19|20)\d{2}\b/);
	if (ym) return new Date(Number.parseInt(ym[0], 10), 5, 1);
	return null;
}

// ============================================================
// HELPERS
// ============================================================

function cleanSpaces(text: string): string {
	return text
		.replace(/ \. /g, ".")
		.replace(/ \+ \+ /g, "++")
		.replace(/ \+ \+/g, "++")
		.replace(/ & /g, "&")
		.replace(/ \/ /g, "/")
		.replace(/ # /g, "#")
		.replace(/\s+,/g, ",")
		.replace(/,\s*$/, "")
		.trim();
}

function cleanPhone(phone: string): string {
	return phone
		.replace(/\(\s+/g, "(")
		.replace(/\s+\)/g, ")")
		.replace(/\s+-\s+/g, "-")
		.replace(/\+\s+/g, "+")
		.replace(/\s+/g, " ")
		.trim();
}

// ============================================================
// DOCUMENT EXTRACTION
// ============================================================

async function loadKreuzberg() {
	try {
		return await import("@kreuzberg/node");
	} catch (error) {
		throw new Error(
			`Document parsing requires @kreuzberg/node. Install dependency or use parseResume() with pre-extracted text.`,
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
	if (options.ocr === true) {
		return {
			ocr: {
				backend: "tesseract" as const,
				language: "eng",
				dpi: 150,
			},
		};
	}
	return {
		ocr: {
			backend: options.ocr.backend || "tesseract",
			language: options.ocr.language || "eng",
			dpi: options.ocr.dpi || 150,
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
			throw new Error(`Could not extract text from ${label} — file may be empty or unreadable`);
		}
		return result.content;
	});
}

// ============================================================
// PUBLIC API
// ============================================================

export async function parseResume(text: string, modelPath: string): Promise<ParsedResume> {
	const ner = await loadPipeline(modelPath);
	const results = (await ner(text)) as NERToken[];
	let spans = mergeSubwords(results);
	spans = spans.map((s) => ({ ...s, text: cleanEntity(s.label, s.text) || "" })).filter((s) => s.text.length > 0);
	spans = applyPostProcessing(spans);

	const grouped = groupIntoEntries(spans);
	const years = computeYears(grouped.experiences);
	const seniority = inferSeniority(grouped.experiences, years);
	const country = inferCountry(grouped.personal.location, grouped.personal.phone);

	return {
		personal: { ...grouped.personal, name: grouped.personal.name ? cleanSpaces(grouped.personal.name) : null },
		experience: grouped.experiences,
		education: grouped.education,
		skills: grouped.skills.map(cleanSpaces),
		certifications: grouped.certifications,
		seniority,
		country,
		experience_years: years,
		_rawText: text,
	};
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

export function computeATSScore(parsed: ParsedResume): ATSResult {
	let score = 0;
	const details: Record<string, ATSCategoryDetail> = {};
	const expCount = parsed.experience.length;
	const skillCount = parsed.skills.length;
	const withTitles = parsed.experience.filter((e) => e.title).length;
	const withCompanies = parsed.experience.filter((e) => e.company).length;
	const withDates = parsed.experience.filter((e) => e.start_date).length;

	// Contact (20)
	let contact = 0;
	if (parsed.personal.name) contact += 5;
	if (parsed.personal.email) contact += 5;
	if (parsed.personal.phone) contact += 5;
	if (parsed.personal.location) contact += 5;
	details.contact = { score: contact, max: 20 };
	score += contact;

	// Experience (25)
	const exp =
		Math.min(expCount * 4, 12) +
		Math.min(withTitles * 2, 4) +
		Math.min(withCompanies * 2, 4) +
		Math.min(withDates * 2, 5);
	details.experience = { score: Math.min(exp, 25), max: 25, roles: expCount };
	score += Math.min(exp, 25);

	// Education (15)
	let edu = 0;
	if (parsed.education.length > 0) edu += 5;
	if (parsed.education.some((e) => e.degree)) edu += 4;
	if (parsed.education.some((e) => e.institution)) edu += 3;
	if (parsed.education.some((e) => e.field)) edu += 3;
	details.education = { score: Math.min(edu, 15), max: 15 };
	score += Math.min(edu, 15);

	// Skills (20)
	let sk = 0;
	if (skillCount >= 1) sk += 4;
	if (skillCount >= 3) sk += 4;
	if (skillCount >= 5) sk += 4;
	if (skillCount >= 8) sk += 4;
	if (skillCount >= 12) sk += 4;
	details.skills = { score: Math.min(sk, 20), max: 20, count: skillCount };
	score += Math.min(sk, 20);

	// Formatting (20)
	let fmt = 0;
	if (expCount >= 2) fmt += 2;
	if (expCount >= 3) fmt += 1;
	if (parsed.experience_years && parsed.experience_years >= 2) fmt += 2;
	if (parsed.certifications.length > 0) fmt += 2;
	const datesWithMonth = parsed.experience.filter((e) => e.start_date && /[a-zA-Z]/.test(e.start_date)).length;
	if (datesWithMonth > 0) fmt += 2;
	if (datesWithMonth === expCount && expCount > 0) fmt += 1;
	if (withTitles === expCount && expCount > 0) fmt += 2;
	if (withCompanies === expCount && expCount > 0) fmt += 2;
	if (contact === 20) fmt += 2;
	if (skillCount >= 8) fmt += 2;
	details.formatting = { score: Math.min(fmt, 20), max: 20 };
	score += Math.min(fmt, 20);

	// Achievements (5)
	const hasQuantified =
		/\d+%|\$[\d,.]+[MBK]?|\b\d{2,}\s*(users|customers|clients|engineers|people|team|employees|members|patients|students|projects|accounts|microservices)/i.test(
			parsed._rawText,
		);
	const hasMetrics =
		/\b(increased|reduced|grew|saved|delivered|generated|managed|led|built|launched|drove|improved|achieved|exceeded|scaled|optimized|automated|streamlined)\b/i.test(
			parsed._rawText,
		);
	const achScore = (hasQuantified ? 3 : 0) + (hasMetrics && hasQuantified ? 2 : 0);
	details.achievements = { score: Math.min(achScore, 5), max: 5, hasQuantified, hasMetrics };
	score += Math.min(achScore, 5);

	// Issues
	const issues: ATSIssue[] = [];
	if (!parsed.personal.name) issues.push({ severity: "high", message: "Name is missing" });
	if (!parsed.personal.email) issues.push({ severity: "high", message: "Email address is missing" });
	if (!parsed.personal.phone) issues.push({ severity: "medium", message: "Phone number is missing" });
	if (!parsed.personal.location) issues.push({ severity: "medium", message: "Location is missing" });
	if (expCount === 0) issues.push({ severity: "high", message: "No work experience detected" });
	if (expCount > 0 && withDates === 0) issues.push({ severity: "high", message: "Employment dates are missing" });
	else if (withDates < expCount)
		issues.push({ severity: "medium", message: `${expCount - withDates} experience entries missing dates` });
	if (expCount > 0 && withTitles === 0) issues.push({ severity: "high", message: "Job titles are missing" });
	if (expCount > 0 && withCompanies === 0) issues.push({ severity: "high", message: "Company names are missing" });
	if (parsed.education.length === 0) issues.push({ severity: "medium", message: "No education section detected" });
	if (skillCount === 0) issues.push({ severity: "high", message: "No skills detected — add a skills section" });
	else if (skillCount < 5)
		issues.push({ severity: "medium", message: "Too few skills — aim for 8-12 relevant skills" });
	if (!parsed.certifications.length) issues.push({ severity: "low", message: "No certifications listed" });
	if (expCount > 0 && !hasQuantified)
		issues.push({
			severity: "medium",
			message: "No quantified achievements — add metrics like '40% increase', 'led team of 12'",
		});

	return { score: Math.min(score, 100), details, issues };
}
