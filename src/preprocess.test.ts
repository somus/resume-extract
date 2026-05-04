import { describe, expect, test } from "bun:test";
import { preprocessResumeText } from "./preprocess";
import type { ResumeConfig } from "./types";

const config: ResumeConfig = {
	seniority_keywords: {},
	seniority_by_years: {},
	seniority_by_experience_count: {},
	phone_country_prefixes: {},
	us_states: [],
	city_country_map: {},
	country_name_aliases: {},
	pre_processing: {
		normalize_dashes: true,
		normalize_bullets: true,
		collapse_multi_spaces: true,
		strip_labels: ["Phone:", "Email:"],
		bullet_chars: ["●", "•"],
		bullet_replacement: "- ",
		dash_replacements: {
			"–": "-",
			"—": "-",
		},
		expand_skill_tables: true,
		skill_table_categories: ["Technical Skills", "Cloud Technologies"],
		table_prose_max_words: 15,
		table_continuation_max_chars: 60,
	},
	post_processing: {
		span_merge_max_gap: 3,
		span_merge_labels: [],
		company_gazetteer_match_max_words: 2,
		title_company_separators: [],
		max_experience_months: 600,
		present_words: [],
		date_words: [],
		space_collapse_pairs: [],
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

describe("resume text preprocessing", () => {
	test("applies config-driven normalization and skill table expansion", () => {
		const rawText =
			"Email: jane@example.com\r\nPhone: +1 555 123 4567\r\n● Built platform — fast\r\nTechnical Skills React,  Node.js\r\nCloud Technologies  AWS,   GCP";

		expect(preprocessResumeText(config, rawText)).toBe(
			"jane@example.com\n+1 555 123 4567\n- Built platform - fast\nTechnical Skills: React, Node.js\nCloud Technologies: AWS, GCP",
		);
	});

	test("leaves table-like lines alone when they look like prose", () => {
		const rawText = "Technical Skills Delivered complex projects across teams without commas or tabular formatting";

		expect(preprocessResumeText(config, rawText)).toBe(rawText);
	});
});
