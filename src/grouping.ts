import {
	cleanEntity,
	getEntityRule,
	getNormalizedExceptions,
	normalizeCertification,
	normalizeSkill,
} from "./postprocess";
import { cleanPhone, cleanSpaces, escapeRegExp } from "./strings";
import type { Education, Experience, GroupedEntries, Personal, ProcessingContext, Span } from "./types";

type DictItem = Experience | Education;

function dedupeDictItems<T extends DictItem>(items: T[]): T[] {
	const seen = new Set<string>();
	const deduped: T[] = [];
	for (const item of items) {
		const key = JSON.stringify(
			Object.entries(item)
				.filter(([, value]) => Boolean(value))
				.sort(([left], [right]) => left.localeCompare(right)),
		);
		if (key !== "[]" && !seen.has(key)) {
			seen.add(key);
			deduped.push(item);
		}
	}
	return deduped;
}

export function cleanExperiences(context: ProcessingContext, experiences: Experience[]): Experience[] {
	const separators = context.config.post_processing.title_company_separators;
	const cleaned = experiences.map((experience) => {
		const next: Experience = {};
		for (const [key, value] of Object.entries(experience)) {
			if (!value) continue;
			next[key as keyof Experience] = cleanSpaces(context.config, value);
		}

		if (next.title && !next.company) {
			for (const separator of separators) {
				const matcher = new RegExp(escapeRegExp(separator.trim()), "i");
				if (!next.title.toLowerCase().includes(separator.toLowerCase())) continue;
				const [title, company] = next.title.split(matcher, 2);
				next.title = cleanSpaces(context.config, title);
				next.company = cleanSpaces(context.config, company);
				break;
			}
		}
		return next;
	});

	if (cleaned.slice(1).some((experience) => experience.company || experience.start_date)) {
		while (cleaned.length > 0 && cleaned[0].title && !cleaned[0].company && !cleaned[0].start_date) {
			cleaned.shift();
		}
	}

	return dedupeDictItems(cleaned);
}

export function cleanEducation(context: ProcessingContext, education: Education[]): Education[] {
	const cleaned = education
		.map((entry) => {
			const next: Education = {};
			for (const [key, value] of Object.entries(entry)) {
				if (!value) continue;
				next[key as keyof Education] = cleanSpaces(context.config, value);
			}
			return next;
		})
		.filter((entry) => Object.keys(entry).length > 0);
	return dedupeDictItems(cleaned);
}

export function groupIntoEntries(context: ProcessingContext, spans: Span[]): GroupedEntries {
	const personal: Personal = { name: null, email: null, phone: null, location: null };
	for (const span of spans) {
		if (span.label === "NAME" && !personal.name) {
			personal.name = span.text;
		} else if (span.label === "EMAIL" && !personal.email) {
			const cleaned = cleanEntity(context, "EMAIL", span.text);
			if (cleaned) personal.email = cleaned;
		} else if (span.label === "PHONE" && !personal.phone) {
			personal.phone = cleanPhone(span.text);
		} else if (span.label === "LOCATION" && !personal.location) {
			personal.location = cleanSpaces(context.config, span.text);
		}
	}

	const experiences: Experience[] = [];
	const experienceSpans = spans
		.filter((span) => ["TITLE", "COMPANY", "DATE"].includes(span.label))
		.sort((left, right) => left.start - right.start);
	const presentPattern = context.config.post_processing.present_words.map((word) => escapeRegExp(word)).join("|");

	let currentExperience: Experience = {};
	for (const span of experienceSpans) {
		if (span.label === "TITLE") {
			if (currentExperience.title && (currentExperience.company || currentExperience.start_date)) {
				experiences.push(currentExperience);
				currentExperience = {};
			}
			currentExperience.title = cleanSpaces(context.config, span.text);
			continue;
		}

		if (span.label === "COMPANY") {
			if (currentExperience.company && (currentExperience.title || currentExperience.start_date)) {
				experiences.push(currentExperience);
				currentExperience = {};
			}
			currentExperience.company = cleanSpaces(context.config, cleanEntity(context, "COMPANY", span.text) || "");
			continue;
		}

		const dateText = span.text.replace(/^[| ]+|[| ]+$/g, "");
		if (!dateText) continue;

		const presentMatch = new RegExp(`^(.+?)\\s+(${presentPattern})$`, "i").exec(dateText);
		if (presentMatch && !currentExperience.start_date) {
			currentExperience.start_date = presentMatch[1].trim();
			currentExperience.end_date = presentMatch[2];
			continue;
		}

		if (
			currentExperience.start_date &&
			!currentExperience.end_date &&
			/^[a-zA-Z]+$/.test(currentExperience.start_date) &&
			/^\d{4}/.test(dateText)
		) {
			const yearMatch = /^(\d{4})\s*(.*)$/.exec(dateText);
			if (yearMatch) {
				currentExperience.start_date = `${currentExperience.start_date} ${yearMatch[1]}`;
				if (yearMatch[2]) currentExperience.end_date = yearMatch[2].trim();
				continue;
			}
		}

		if (currentExperience.start_date && currentExperience.end_date) {
			if (currentExperience.title || currentExperience.company) {
				experiences.push(currentExperience);
				currentExperience = {};
			}
		}

		if (!currentExperience.start_date) {
			currentExperience.start_date = dateText;
		} else if (!currentExperience.end_date) {
			currentExperience.end_date = dateText;
		}
	}
	if (currentExperience.title || currentExperience.company) {
		experiences.push(currentExperience);
	}

	const educationSpans = spans
		.filter((span) => ["DEGREE", "FIELD", "INSTITUTION"].includes(span.label))
		.sort((left, right) => left.start - right.start);
	const education: Education[] = [];
	let currentEducation: Education = {};
	for (const span of educationSpans) {
		if (span.label === "DEGREE") {
			if (currentEducation.degree) {
				education.push(currentEducation);
				currentEducation = {};
			}
			currentEducation.degree = cleanSpaces(context.config, span.text);
		} else if (span.label === "FIELD") {
			currentEducation.field = cleanSpaces(context.config, span.text);
		} else if (span.label === "INSTITUTION") {
			currentEducation.institution = cleanSpaces(context.config, span.text).replace(/,?\s*\d{4}\s*$/g, "");
			education.push(currentEducation);
			currentEducation = {};
		}
	}
	if (currentEducation.degree || currentEducation.institution) {
		education.push(currentEducation);
	}

	const skillRules = getEntityRule(context.config, "SKILL");
	const skillExceptions = getNormalizedExceptions(skillRules);
	const skills: string[] = [];
	const seenSkills = new Set<string>();
	for (const span of spans) {
		if (span.label !== "SKILL") continue;
		for (const part of span.text.split(/,\s*/)) {
			const normalized = normalizeSkill(context.config, part);
			if (!normalized) continue;
			const normalizedKey = normalized.toLowerCase();
			if (seenSkills.has(normalizedKey)) continue;
			if (
				normalized.length < (skillRules.min_length ?? 2) &&
				normalized !== normalized.toUpperCase() &&
				!skillExceptions.has(normalizedKey)
			) {
				continue;
			}
			seenSkills.add(normalizedKey);
			skills.push(normalized);
		}
	}

	const certifications: string[] = [];
	const seenCertifications = new Set<string>();
	for (const span of spans) {
		if (span.label !== "CERT") continue;
		const normalized = normalizeCertification(context.config, span.text);
		if (normalized.length <= 1 || seenCertifications.has(normalized.toLowerCase())) continue;
		seenCertifications.add(normalized.toLowerCase());
		certifications.push(normalized);
	}

	return {
		personal,
		experiences: cleanExperiences(context, experiences),
		education: cleanEducation(context, education),
		skills,
		certifications,
	};
}
