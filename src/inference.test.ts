import { describe, expect, test } from "bun:test";
import { cleanExperiences } from "./grouping";
import { computeYears, inferCountry, inferSeniority, parseDate } from "./inference";
import type { ProcessingContext, ResumeConfig } from "./types";

const config: ResumeConfig = {
	seniority_keywords: {
		Senior: ["senior"],
		Mid: ["mid"],
		Junior: ["junior"],
	},
	seniority_by_years: {
		Staff: 15,
		Senior: 8,
		Mid: 3,
		Junior: 0,
	},
	seniority_by_experience_count: {
		Senior: 4,
		Mid: 2,
		Junior: 0,
	},
	phone_country_prefixes: {
		"+91": "India",
		"+1": "United States",
	},
	us_states: ["WA", "CA"],
	city_country_map: {
		seattle: "United States",
		bengaluru: "India",
	},
	country_name_aliases: {
		bharat: "India",
		usa: "United States",
	},
	multi_word_skills: [],
	post_processing: {
		span_merge_max_gap: 3,
		span_merge_labels: ["TITLE", "COMPANY"],
		company_gazetteer_match_max_words: 2,
		title_company_separators: [" at "],
		max_experience_months: 24,
		present_words: ["present", "current"],
		date_words: ["present"],
		space_collapse_pairs: [[" & ", "&"]],
		entity_rules: {
			COMPANY: {},
			TITLE: {},
			SKILL: {},
			CERT: {},
			DATE: {},
			EMAIL: {},
		},
	},
};

const context: ProcessingContext = {
	config,
	companies: new Set(["acme"]),
};

describe("inference helpers", () => {
	test("uses experience-count fallback for seniority", () => {
		const level = inferSeniority(
			config,
			[{ title: "Engineer" }, { title: "Engineer II" }, { title: "Engineer III" }, { title: "Engineer IV" }],
			null,
		);

		expect(level).toBe("Senior");
	});

	test("uses alias, phone, and state fallbacks for country", () => {
		expect(inferCountry(config, "Bharat", null)).toBe("India");
		expect(inferCountry(config, "Remote, WA", null)).toBe("United States");
		expect(inferCountry(config, null, "+91 99999 99999")).toBe("India");
		expect(inferCountry(config, "Unknown", null)).toBeNull();
	});

	test("floors years and ignores implausibly long ranges", () => {
		const years = computeYears(config, [
			{ start_date: "January 2020", end_date: "December 2021" },
			{ start_date: "January 2000", end_date: "January 2025" },
		]);

		expect(years).toBe(1);
	});

	test("parses month-year and year-only dates", () => {
		expect(parseDate("June 2022")?.getMonth()).toBe(5);
		expect(parseDate("2020")?.getMonth()).toBe(5);
		expect(parseDate("unknown")).toBeNull();
	});
});

describe("grouping helpers", () => {
	test("splits title/company strings and drops leading orphan titles", () => {
		const experiences = cleanExperiences(context, [
			{ title: "Profile Summary" },
			{ title: "Staff Engineer at Acme" },
			{ company: "Acme", start_date: "January 2020" },
		]);

		expect(experiences).toEqual([
			{ title: "Staff Engineer", company: "Acme" },
			{ company: "Acme", start_date: "January 2020" },
		]);
	});
});
