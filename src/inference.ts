import { escapeRegExp } from "./strings";
import type { Experience, ResumeConfig } from "./types";

export function inferSeniority(config: ResumeConfig, experiences: Experience[], years: number | null): string {
	const titles = experiences.map((experience) => (experience.title || "").toLowerCase()).filter(Boolean);
	for (const [level, keywords] of Object.entries(config.seniority_keywords)) {
		for (const title of titles) {
			for (const keyword of keywords) {
				if (title.includes(keyword)) return level;
			}
		}
	}

	if (years != null) {
		const bounds = config.seniority_by_years;
		if (years >= bounds.Staff) return "Staff";
		if (years >= bounds.Senior) return "Senior";
		if (years >= bounds.Mid) return "Mid";
		return "Junior";
	}

	for (const [level, minimumCount] of Object.entries(config.seniority_by_experience_count).sort(
		([, left], [, right]) => right - left,
	)) {
		if (experiences.length >= minimumCount) return level;
	}
	return "Junior";
}

export function inferCountry(config: ResumeConfig, location: string | null, phone: string | null): string | null {
	if (phone) {
		const clean = phone.replace(/[\s\-()]/g, "");
		for (const [prefix, country] of Object.entries(config.phone_country_prefixes)) {
			if (clean.startsWith(prefix)) return country;
		}
	}

	if (!location) return null;
	const normalizedLocation = location.toLowerCase();
	for (const [alias, country] of Object.entries(config.country_name_aliases)) {
		if (normalizedLocation.includes(alias)) return country;
	}
	for (const [city, country] of Object.entries(config.city_country_map || {})) {
		if (normalizedLocation.includes(city)) return country;
	}
	for (const part of normalizedLocation.replace(/,/g, " ").split(/\s+/)) {
		if (config.us_states.includes(part.toUpperCase())) return "United States";
	}
	return null;
}

export function computeYears(config: ResumeConfig, experiences: Experience[]): number | null {
	let totalMonths = 0;
	const now = new Date();
	const presentPattern = config.post_processing.present_words.map((word) => escapeRegExp(word)).join("|");
	const presentMatcher = new RegExp(presentPattern, "i");

	for (const experience of experiences) {
		if (!experience.start_date) continue;
		const start = parseDate(experience.start_date);
		if (!start) continue;

		let end: Date;
		if (!experience.end_date || presentMatcher.test(experience.end_date)) {
			end = now;
		} else {
			const parsedEnd = parseDate(experience.end_date);
			if (!parsedEnd) continue;
			end = parsedEnd;
		}

		const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
		if (months > 0 && months < config.post_processing.max_experience_months) {
			totalMonths += months;
		}
	}

	return totalMonths > 0 ? Math.floor(totalMonths / 12) : null;
}

export function parseDate(text: string): Date | null {
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

	const normalized = text.toLowerCase().trim();
	for (const [name, month] of Object.entries(months)) {
		const match = normalized.match(new RegExp(`${name}\\s+(\\d{4})`));
		if (match) return new Date(Number.parseInt(match[1], 10), month, 1);
	}

	const yearMatch = text.match(/\b(19|20)\d{2}\b/);
	if (yearMatch) return new Date(Number.parseInt(yearMatch[0], 10), 5, 1);
	return null;
}
