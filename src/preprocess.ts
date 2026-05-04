import { escapeRegExp } from "./strings";
import type { ResumeConfig } from "./types";

const DEFAULT_DASH_REPLACEMENTS: Record<string, string> = {
	"–": "-",
	"—": "-",
};

const DEFAULT_BULLET_CHARS = ["●", "•", "▪", "■", "▸", "►", "‣", "⁃"];

function normalizeWhitespace(text: string): string {
	return text
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.split("\n")
		.map((line) => line.replace(/\s+$/g, ""))
		.join("\n");
}

function normalizeDashes(config: ResumeConfig, text: string): string {
	const replacements = config.pre_processing?.dash_replacements || DEFAULT_DASH_REPLACEMENTS;
	let result = text;
	for (const [oldValue, newValue] of Object.entries(replacements)) {
		result = result.replaceAll(oldValue, newValue);
	}
	return result;
}

function normalizeBullets(config: ResumeConfig, text: string): string {
	const bulletChars = config.pre_processing?.bullet_chars || DEFAULT_BULLET_CHARS;
	if (bulletChars.length === 0) return text;
	const replacement = config.pre_processing?.bullet_replacement || "- ";
	return text.replace(new RegExp(`^[${escapeRegExp(bulletChars.join(""))}]\\s*`, "gm"), replacement);
}

function stripLabels(config: ResumeConfig, text: string): string {
	let result = text;
	for (const label of config.pre_processing?.strip_labels || []) {
		result = result.replace(new RegExp(`\\b${escapeRegExp(label)}\\s*`, "gi"), "");
	}
	return result;
}

function buildSkillCategoryPattern(config: ResumeConfig): RegExp | null {
	const categories = config.pre_processing?.skill_table_categories || [];
	if (categories.length === 0) return null;
	const sorted = [...categories].sort((left, right) => right.length - left.length);
	return new RegExp(`^(${sorted.map(escapeRegExp).join("|")})\\s+([A-Za-z0-9#.+].+)$`, "i");
}

function expandFlattenedTable(config: ResumeConfig, text: string): string {
	const categoryPattern = buildSkillCategoryPattern(config);
	if (!categoryPattern) return text;

	const maxProseWords = config.pre_processing?.table_prose_max_words ?? 15;
	const maxContinuationChars = config.pre_processing?.table_continuation_max_chars ?? 60;
	const lines = text.split("\n");
	const result: string[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		let match = line.trim().match(categoryPattern);

		if (!match) {
			const multiSpaceMatch = line.match(/^([A-Za-z][A-Za-z\s&/()-]{2,40}?)\s{2,}([A-Za-z0-9#.+].+)$/);
			if (multiSpaceMatch?.[2].includes(",")) {
				match = multiSpaceMatch;
			}
		}

		if (!match) {
			result.push(line);
			continue;
		}

		const category = match[1].trim();
		let items = match[2].trim();
		const words = items.split(/\s+/);
		if (words.length > maxProseWords || (!items.includes(",") && words.length > 5)) {
			result.push(line);
			continue;
		}

		while (index + 1 < lines.length) {
			const nextRawLine = lines[index + 1];
			const nextLine = nextRawLine.trim();
			const isContinuation =
				/^\s{2,}[A-Za-z0-9#.+]/.test(nextRawLine) ||
				(Boolean(nextLine) &&
					/^[A-Z]/.test(nextLine) &&
					nextLine.includes(",") &&
					!categoryPattern.test(nextLine) &&
					nextLine.length < maxContinuationChars);

			if (!isContinuation) break;
			index += 1;
			items += ` ${nextLine}`;
		}

		items = items
			.replace(/\s*,\s*/g, ", ")
			.replace(/,+$/g, "")
			.trim();
		result.push(`${category}: ${items}`);
	}

	return result.join("\n");
}

function collapseMultiSpaces(text: string): string {
	return text.replace(/ {2,}/g, " ");
}

export function preprocessResumeText(config: ResumeConfig, text: string): string {
	let result = normalizeWhitespace(text);
	if (config.pre_processing?.normalize_dashes !== false) {
		result = normalizeDashes(config, result);
	}
	if (config.pre_processing?.normalize_bullets !== false) {
		result = normalizeBullets(config, result);
	}
	result = stripLabels(config, result);
	if (config.pre_processing?.expand_skill_tables !== false) {
		result = expandFlattenedTable(config, result);
	}
	if (config.pre_processing?.collapse_multi_spaces !== false) {
		result = collapseMultiSpaces(result);
	}
	return result.trim();
}
