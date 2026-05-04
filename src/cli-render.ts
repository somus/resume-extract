import { basename } from "node:path";
import type { ATSResult, ParsedResume } from "./types";

export interface CliExtractResult {
	input?: string;
	parsed: ParsedResume;
	ats?: ATSResult;
}

export interface CliBatchItemResult {
	input: string;
	parsed?: ParsedResume;
	ats?: ATSResult;
	error?: string;
}

function formatList(items: string[]): string {
	return items.length > 0 ? items.join(", ") : "None";
}

function formatMaybe(value: string | number | null | undefined): string {
	return value == null || value === "" ? "-" : String(value);
}

function formatSection(title: string, lines: string[]): string {
	return `${title}\n${lines.map((line) => `  ${line}`).join("\n")}`;
}

export function renderExtractPretty(result: CliExtractResult): string {
	const sections: string[] = [];
	if (result.input) {
		sections.push(formatSection("Input", [result.input]));
	}

	sections.push(
		formatSection("Personal", [
			`Name: ${formatMaybe(result.parsed.personal.name)}`,
			`Email: ${formatMaybe(result.parsed.personal.email)}`,
			`Phone: ${formatMaybe(result.parsed.personal.phone)}`,
			`Location: ${formatMaybe(result.parsed.personal.location)}`,
		]),
	);

	sections.push(
		formatSection(
			"Experience",
			result.parsed.experience.length > 0
				? result.parsed.experience.map((experience, index) => {
						const company = formatMaybe(experience.company);
						const title = formatMaybe(experience.title);
						const start = formatMaybe(experience.start_date);
						const end = formatMaybe(experience.end_date);
						return `${index + 1}. ${title} @ ${company} (${start} -> ${end})`;
					})
				: ["None"],
		),
	);

	sections.push(
		formatSection(
			"Education",
			result.parsed.education.length > 0
				? result.parsed.education.map((education, index) => {
						const parts = [education.degree, education.field, education.institution].filter(Boolean);
						return `${index + 1}. ${parts.join(" | ") || "-"}`;
					})
				: ["None"],
		),
	);

	sections.push(formatSection("Skills", [formatList(result.parsed.skills)]));
	sections.push(formatSection("Certifications", [formatList(result.parsed.certifications)]));
	sections.push(
		formatSection("Derived", [
			`Seniority: ${result.parsed.seniority}`,
			`Country: ${formatMaybe(result.parsed.country)}`,
			`Experience Years: ${formatMaybe(result.parsed.experience_years)}`,
		]),
	);

	if (result.ats) {
		sections.push(
			formatSection("ATS", [
				`Score: ${result.ats.score}`,
				`Issues: ${result.ats.issues.length > 0 ? result.ats.issues.map((issue) => `${issue.severity}:${issue.message}`).join(" | ") : "None"}`,
			]),
		);
	}

	return sections.join("\n\n");
}

function pad(value: string, width: number): string {
	return value.length >= width ? value : value.padEnd(width);
}

export function renderBatchPretty(results: CliBatchItemResult[]): string {
	const total = results.length;
	const successCount = results.filter((result) => !result.error).length;
	const failureCount = total - successCount;
	const rows = results.map((result) => {
		const status = result.error ? "ERROR" : "OK";
		const score = result.ats ? String(result.ats.score) : "-";
		const seniority = result.parsed?.seniority || "-";
		const country = result.parsed?.country || "-";
		const file = basename(result.input);
		return [file, status, score, seniority, country];
	});

	const widths = [32, 8, 7, 10, 16];
	const header = [
		pad("File", widths[0]),
		pad("Status", widths[1]),
		pad("ATS", widths[2]),
		pad("Seniority", widths[3]),
		pad("Country", widths[4]),
	].join("  ");
	const body = rows.map((row) => row.map((cell, index) => pad(cell, widths[index])).join("  ")).join("\n");
	const failures = results
		.filter((result) => result.error)
		.map((result) => `  - ${basename(result.input)}: ${result.error}`)
		.join("\n");

	return [
		`Processed ${total} file(s): ${successCount} succeeded, ${failureCount} failed`,
		"",
		header,
		body || "No files processed",
		...(failures ? ["", "Failures", failures] : []),
	].join("\n");
}

export function buildStructuredOutput(
	data: CliExtractResult | CliBatchItemResult[],
	format: "json" | "jsonl" | "csv",
	pretty = true,
): string {
	if (format === "csv") {
		if (!Array.isArray(data)) {
			throw new Error("CSV output is only supported for batch results.");
		}
		const experienceColumnCount = maxExperienceCount(data);
		const educationColumnCount = maxEducationCount(data);
		const header = [
			"input",
			"status",
			"name",
			"email",
			"phone",
			"location",
			"country",
			"seniority",
			"experience_years",
			"experience_count",
			"education_count",
			"experience_summary",
			"education_summary",
			"skills",
			"certifications",
			"ats_score",
			"error",
			...buildExperienceColumns(experienceColumnCount),
			...buildEducationColumns(educationColumnCount),
		];
		const rows = data.map((item) => {
			const result = item as CliBatchItemResult;
			const experienceColumns = buildExperienceValues(result, experienceColumnCount);
			const educationColumns = buildEducationValues(result, educationColumnCount);
			return [
				result.input,
				result.error ? "error" : "ok",
				result.parsed?.personal.name || "",
				result.parsed?.personal.email || "",
				result.parsed?.personal.phone || "",
				result.parsed?.personal.location || "",
				result.parsed?.country || "",
				result.parsed?.seniority || "",
				result.parsed?.experience_years == null ? "" : String(result.parsed.experience_years),
				result.parsed?.experience.length == null ? "" : String(result.parsed.experience.length),
				result.parsed?.education.length == null ? "" : String(result.parsed.education.length),
				result.parsed?.experience.map(formatExperienceCsv).join(" || ") || "",
				result.parsed?.education.map(formatEducationCsv).join(" || ") || "",
				result.parsed?.skills.join("; ") || "",
				result.parsed?.certifications.join("; ") || "",
				result.ats ? String(result.ats.score) : "",
				result.error || "",
				...experienceColumns,
				...educationColumns,
			].map(escapeCsvCell);
		});
		return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
	}

	if (format === "jsonl") {
		const lines = Array.isArray(data) ? data.map((item) => JSON.stringify(item)) : [JSON.stringify(data)];
		return lines.join("\n");
	}
	return JSON.stringify(data, null, pretty ? 2 : 0);
}

function escapeCsvCell(value: string): string {
	if (/[",\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function formatExperienceCsv(experience: ParsedResume["experience"][number]): string {
	const title = experience.title || "-";
	const company = experience.company || "-";
	const start = experience.start_date || "-";
	const end = experience.end_date || "-";
	return `${title} @ ${company} (${start} -> ${end})`;
}

function formatEducationCsv(education: ParsedResume["education"][number]): string {
	return [education.degree, education.field, education.institution].filter(Boolean).join(" | ");
}

function maxExperienceCount(results: CliBatchItemResult[]): number {
	return Math.max(0, ...results.map((result) => result.parsed?.experience.length || 0));
}

function maxEducationCount(results: CliBatchItemResult[]): number {
	return Math.max(0, ...results.map((result) => result.parsed?.education.length || 0));
}

function buildExperienceColumns(count: number): string[] {
	const columns: string[] = [];
	for (let index = 1; index <= count; index++) {
		columns.push(`exp_${index}_title`, `exp_${index}_company`, `exp_${index}_start_date`, `exp_${index}_end_date`);
	}
	return columns;
}

function buildEducationColumns(count: number): string[] {
	const columns: string[] = [];
	for (let index = 1; index <= count; index++) {
		columns.push(`edu_${index}_degree`, `edu_${index}_field`, `edu_${index}_institution`);
	}
	return columns;
}

function buildExperienceValues(result: CliBatchItemResult, count: number): string[] {
	const values: string[] = [];
	for (let index = 0; index < count; index++) {
		const experience = result.parsed?.experience[index];
		values.push(
			experience?.title || "",
			experience?.company || "",
			experience?.start_date || "",
			experience?.end_date || "",
		);
	}
	return values;
}

function buildEducationValues(result: CliBatchItemResult, count: number): string[] {
	const values: string[] = [];
	for (let index = 0; index < count; index++) {
		const education = result.parsed?.education[index];
		values.push(education?.degree || "", education?.field || "", education?.institution || "");
	}
	return values;
}
