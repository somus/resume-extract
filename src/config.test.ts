import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCompanies, loadResumeConfig } from "./config";

function withTempDir(run: (dir: string) => void) {
	const dir = mkdtempSync(join(tmpdir(), "resume-extract-config-"));
	try {
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("config loading", () => {
	test("validates required entity rules", () => {
		withTempDir((dir) => {
			writeFileSync(
				join(dir, "resume_config.json"),
				JSON.stringify({
					seniority_keywords: {},
					seniority_by_years: {},
					seniority_by_experience_count: {},
					phone_country_prefixes: {},
					us_states: [],
					city_country_map: {},
					country_name_aliases: {},
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
						},
					},
				}),
			);

			expect(() => loadResumeConfig(dir)).toThrow(/post_processing\.entity_rules\.EMAIL/);
		});
	});

	test("returns an empty company set when companies.json is absent", () => {
		withTempDir((dir) => {
			expect(loadCompanies(dir).size).toBe(0);
		});
	});

	test("loads city-country aliases from an external file when configured", () => {
		withTempDir((dir) => {
			writeFileSync(
				join(dir, "resume_config.json"),
				JSON.stringify({
					seniority_keywords: {},
					seniority_by_years: {},
					seniority_by_experience_count: {},
					phone_country_prefixes: {},
					us_states: [],
					city_country_map_file: "city_country_map.json",
					country_name_aliases: {},
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
				}),
			);
			writeFileSync(
				join(dir, "city_country_map.json"),
				JSON.stringify({
					india: { bangalore: "India" },
					usa: { seattle: "United States" },
				}),
			);

			const config = loadResumeConfig(dir);
			expect(config.city_country_map).toEqual({
				bangalore: "India",
				seattle: "United States",
			});
		});
	});

	test("validates pre-processing config types when provided", () => {
		withTempDir((dir) => {
			writeFileSync(
				join(dir, "resume_config.json"),
				JSON.stringify({
					seniority_keywords: {},
					seniority_by_years: {},
					seniority_by_experience_count: {},
					phone_country_prefixes: {},
					us_states: [],
					city_country_map: {},
					country_name_aliases: {},
					pre_processing: {
						strip_labels: "Email:",
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
				}),
			);

			expect(() => loadResumeConfig(dir)).toThrow(/pre_processing\.strip_labels/);
		});
	});

	test("throws a descriptive error for corrupt JSON", () => {
		withTempDir((dir) => {
			writeFileSync(join(dir, "resume_config.json"), "{ invalid json");

			expect(() => loadResumeConfig(dir)).toThrow(/Failed to parse.*resume_config\.json/);
		});
	});

	test("throws a descriptive error for corrupt companies.json", () => {
		withTempDir((dir) => {
			writeFileSync(join(dir, "companies.json"), "not json");

			expect(() => loadCompanies(dir)).toThrow(/Failed to parse.*companies\.json/);
		});
	});
});
