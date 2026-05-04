import { cleanSpaces, escapeRegExp } from "./strings";
import type { EntityRuleConfig, NERToken, ProcessingContext, ResumeConfig, Span } from "./types";

export function getEntityRule(config: ResumeConfig, label: string): EntityRuleConfig {
	return config.post_processing.entity_rules[label] || {};
}

export function getNormalizedExceptions(rules: EntityRuleConfig): Set<string> {
	return new Set((rules.exceptions || []).map((value) => value.toLowerCase()));
}

export function cleanEntity(context: ProcessingContext, label: string, raw: string): string | null {
	let cleaned = raw
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[,.;:|/\-\s]+|[,.;:|/\-\s]+$/g, "");
	if (!cleaned || (cleaned.length === 1 && !/[a-zA-Z]/.test(cleaned))) return null;
	if (/^[\W_]+$/.test(cleaned)) return null;

	const rules = getEntityRule(context.config, label);
	if (label === "EMAIL") {
		cleaned = cleaned.replace(/\s+/g, "");
		for (const prefix of rules.strip_prefixes || []) {
			cleaned = cleaned.replace(new RegExp(`^${escapeRegExp(prefix)}\\s*`, "i"), "");
		}
		cleaned = cleaned.replace(/^[^a-zA-Z0-9]+/, "");
		if (rules.require && !cleaned.includes(rules.require)) return null;
		for (const pattern of rules.reject_patterns || []) {
			if (cleaned.toLowerCase().includes(pattern.toLowerCase())) return null;
		}
	} else if (label === "SKILL") {
		cleaned = cleaned.replace(/[,.;:]+$/g, "");
	} else if (label === "COMPANY") {
		if (rules.strip_trailing_state_code) {
			cleaned = cleaned.replace(/,?\s+[A-Z]{2}$/g, "").trim();
		}
	} else if (label === "DATE") {
		cleaned = cleaned.replace(/^[| ]+|[| ]+$/g, "");
	}

	if (!cleaned) return null;

	const exceptions = getNormalizedExceptions(rules);
	const blockedWords = new Set((rules.blocked_words || []).map((value) => value.toLowerCase()));
	if (blockedWords.has(cleaned.toLowerCase())) return null;
	if (exceptions.has(cleaned.toLowerCase())) return cleaned;

	const minLength = rules.min_length ?? 2;
	if (cleaned.length < minLength) {
		if (rules.gazetteer_bypass && context.companies.has(cleaned.toLowerCase())) return cleaned;
		if (rules.uppercase_bypass && cleaned === cleaned.toUpperCase()) return cleaned;
		return null;
	}

	return cleaned;
}

export function mergeSubwords(results: NERToken[]): Span[] {
	const tokens: Span[] = [];
	for (const result of results) {
		const entity = result.entity_group || result.entity || "O";
		const word = result.word || "";
		const isSubword = word.startsWith("##");
		const cleanWord = isSubword ? word.slice(2) : word;
		const baseLabel = entity.replace(/^[BI]-/, "");

		if (isSubword && tokens.length > 0) {
			tokens[tokens.length - 1].text += cleanWord;
			tokens[tokens.length - 1].end = result.end || tokens[tokens.length - 1].end;
			continue;
		}

		tokens.push({
			label: baseLabel === "O" ? "O" : baseLabel,
			bio: entity.startsWith("B-") ? "B" : entity.startsWith("I-") ? "I" : "O",
			text: cleanWord,
			start: result.start || 0,
			end: result.end || 0,
			score: result.score || 0,
		});
	}

	const merged: Span[] = [];
	for (const token of tokens) {
		if (token.label === "O") continue;
		if (merged.length > 0 && merged[merged.length - 1].label === token.label && token.bio === "I") {
			merged[merged.length - 1].text += ` ${token.text}`;
			merged[merged.length - 1].end = token.end;
			continue;
		}
		merged.push({ ...token });
	}
	return merged;
}

function mergeSameLabelNeighbors(spans: Span[], labels: Set<string>, maxGap: number): Span[] {
	const merged: Span[] = [];
	for (const span of spans) {
		const previous = merged[merged.length - 1];
		if (previous && labels.has(span.label) && previous.label === span.label && span.start - previous.end <= maxGap) {
			merged[merged.length - 1] = {
				...previous,
				text: `${previous.text} ${span.text}`,
				end: span.end,
				score: Math.max(previous.score, span.score),
			};
			continue;
		}
		merged.push(span);
	}
	return merged;
}

export function applyPostProcessing(context: ProcessingContext, spans: Span[]): Span[] {
	const multiWordSkills = new Set((context.config.multi_word_skills || []).map((skill) => skill.toLowerCase()));
	const postProcessing = context.config.post_processing;
	const dateWords = new Set(postProcessing.date_words.map((word) => word.toLowerCase()));

	const mergedNeighbors = mergeSameLabelNeighbors(
		spans,
		new Set(postProcessing.span_merge_labels),
		postProcessing.span_merge_max_gap,
	);

	const relabeled = mergedNeighbors.map((span) => {
		if (span.label === "TITLE" && context.companies.has(span.text.toLowerCase().trim())) {
			return { ...span, label: "COMPANY" };
		}
		return span;
	});

	const strippedCompanies = relabeled.map((span) => {
		if (span.label !== "COMPANY") return span;
		const words = span.text.split(/\s+/);
		while (
			words.length > 1 &&
			(dateWords.has(words[words.length - 1].toLowerCase()) || /^\d{4}$/.test(words[words.length - 1]))
		) {
			words.pop();
		}
		return { ...span, text: words.join(" ") };
	});

	const splitTitles = strippedCompanies.flatMap((span) => {
		if (span.label !== "TITLE") return [span];
		const words = span.text.split(" ");
		for (let length = Math.min(postProcessing.company_gazetteer_match_max_words, words.length); length >= 1; length--) {
			const prefix = words.slice(0, length).join(" ");
			if (context.companies.has(prefix.toLowerCase())) {
				const suffix = words.slice(length).join(" ");
				return [
					{ ...span, label: "COMPANY", text: prefix },
					...(suffix.length > 1 ? [{ ...span, label: "TITLE", text: suffix }] : []),
				];
			}
		}
		return [span];
	});

	const mergedSkills: Span[] = [];
	for (let index = 0; index < splitTitles.length; index++) {
		const current = splitTitles[index];
		const next = splitTitles[index + 1];
		if (current.label === "SKILL" && next?.label === "SKILL") {
			const combined = `${current.text} ${next.text}`.replace(/[,.]$/g, "");
			if (multiWordSkills.has(combined.toLowerCase())) {
				mergedSkills.push({ ...current, text: combined, end: next.end });
				index += 1;
				continue;
			}
		}
		mergedSkills.push(current);
	}

	return mergedSkills;
}

export function normalizeSkill(config: ResumeConfig, text: string): string {
	const normalized = cleanSpaces(config, text.trim().replace(/[,.]$/g, ""));
	return getEntityRule(config, "SKILL").aliases?.[normalized.toLowerCase()] || normalized;
}

export function normalizeCertification(config: ResumeConfig, text: string): string {
	const normalized = cleanSpaces(config, text.trim().replace(/[,.]$/g, "")).replace(/^the\s+/i, "");
	return getEntityRule(config, "CERT").aliases?.[normalized.toLowerCase()] || normalized;
}
