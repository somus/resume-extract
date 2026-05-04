import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResumeConfig } from "./types";

const REQUIRED_ENTITY_RULES = ["COMPANY", "TITLE", "SKILL", "CERT", "DATE", "EMAIL"] as const;

function ensureObject(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid resume_config.json: expected ${name} to be an object`);
	}
	return value as Record<string, unknown>;
}

function ensureStringArray(value: unknown, name: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`Invalid resume_config.json: expected ${name} to be a string array`);
	}
	return value;
}

function ensureString(value: unknown, name: string): string {
	if (typeof value !== "string") {
		throw new Error(`Invalid resume_config.json: expected ${name} to be a string`);
	}
	return value;
}

function ensureBoolean(value: unknown, name: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`Invalid resume_config.json: expected ${name} to be a boolean`);
	}
	return value;
}

function ensureReplacementPairs(value: unknown, name: string): [string, string][] {
	if (
		!Array.isArray(value) ||
		value.some(
			(item) => !Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" || typeof item[1] !== "string",
		)
	) {
		throw new Error(`Invalid resume_config.json: expected ${name} to be an array of string pairs`);
	}
	return value as [string, string][];
}

function ensureNumber(value: unknown, name: string): number {
	if (typeof value !== "number" || Number.isNaN(value)) {
		throw new Error(`Invalid resume_config.json: expected ${name} to be a number`);
	}
	return value;
}

function ensureStringRecord(value: unknown, name: string): Record<string, string> {
	const object = ensureObject(value, name);
	for (const [key, entry] of Object.entries(object)) {
		if (typeof entry !== "string") {
			throw new Error(`Invalid resume_config.json: expected ${name}.${key} to be a string`);
		}
	}
	return object as Record<string, string>;
}

export function assertResumeConfig(config: unknown): asserts config is ResumeConfig {
	const root = ensureObject(config, "root");
	ensureObject(root.seniority_keywords, "seniority_keywords");
	ensureObject(root.seniority_by_years, "seniority_by_years");
	ensureObject(root.seniority_by_experience_count, "seniority_by_experience_count");
	ensureObject(root.phone_country_prefixes, "phone_country_prefixes");
	ensureStringArray(root.us_states, "us_states");
	if (root.city_country_map !== undefined) {
		ensureObject(root.city_country_map, "city_country_map");
	}
	if (root.city_country_map_file !== undefined) {
		ensureString(root.city_country_map_file, "city_country_map_file");
	}
	if (root.city_country_map === undefined && root.city_country_map_file === undefined) {
		throw new Error("Invalid resume_config.json: expected city_country_map or city_country_map_file to be set");
	}
	ensureObject(root.country_name_aliases, "country_name_aliases");
	if (root.multi_word_skills !== undefined) {
		ensureStringArray(root.multi_word_skills, "multi_word_skills");
	}
	if (root.pre_processing !== undefined) {
		const preProcessing = ensureObject(root.pre_processing, "pre_processing");
		if (preProcessing.normalize_dashes !== undefined) {
			ensureBoolean(preProcessing.normalize_dashes, "pre_processing.normalize_dashes");
		}
		if (preProcessing.normalize_bullets !== undefined) {
			ensureBoolean(preProcessing.normalize_bullets, "pre_processing.normalize_bullets");
		}
		if (preProcessing.collapse_multi_spaces !== undefined) {
			ensureBoolean(preProcessing.collapse_multi_spaces, "pre_processing.collapse_multi_spaces");
		}
		if (preProcessing.expand_skill_tables !== undefined) {
			ensureBoolean(preProcessing.expand_skill_tables, "pre_processing.expand_skill_tables");
		}
		if (preProcessing.strip_labels !== undefined) {
			ensureStringArray(preProcessing.strip_labels, "pre_processing.strip_labels");
		}
		if (preProcessing.bullet_chars !== undefined) {
			ensureStringArray(preProcessing.bullet_chars, "pre_processing.bullet_chars");
		}
		if (preProcessing.bullet_replacement !== undefined) {
			ensureString(preProcessing.bullet_replacement, "pre_processing.bullet_replacement");
		}
		if (preProcessing.dash_replacements !== undefined) {
			ensureStringRecord(preProcessing.dash_replacements, "pre_processing.dash_replacements");
		}
		if (preProcessing.skill_table_categories !== undefined) {
			ensureStringArray(preProcessing.skill_table_categories, "pre_processing.skill_table_categories");
		}
		if (preProcessing.table_prose_max_words !== undefined) {
			ensureNumber(preProcessing.table_prose_max_words, "pre_processing.table_prose_max_words");
		}
		if (preProcessing.table_continuation_max_chars !== undefined) {
			ensureNumber(preProcessing.table_continuation_max_chars, "pre_processing.table_continuation_max_chars");
		}
	}

	const postProcessing = ensureObject(root.post_processing, "post_processing");
	ensureNumber(postProcessing.span_merge_max_gap, "post_processing.span_merge_max_gap");
	ensureStringArray(postProcessing.span_merge_labels, "post_processing.span_merge_labels");
	ensureNumber(postProcessing.company_gazetteer_match_max_words, "post_processing.company_gazetteer_match_max_words");
	ensureStringArray(postProcessing.title_company_separators, "post_processing.title_company_separators");
	ensureNumber(postProcessing.max_experience_months, "post_processing.max_experience_months");
	ensureStringArray(postProcessing.present_words, "post_processing.present_words");
	ensureStringArray(postProcessing.date_words, "post_processing.date_words");
	ensureReplacementPairs(postProcessing.space_collapse_pairs, "post_processing.space_collapse_pairs");

	const entityRules = ensureObject(postProcessing.entity_rules, "post_processing.entity_rules");
	for (const rule of REQUIRED_ENTITY_RULES) {
		ensureObject(entityRules[rule], `post_processing.entity_rules.${rule}`);
	}
}

export function loadResumeConfig(modelPath: string): ResumeConfig {
	const configPath = join(modelPath, "resume_config.json");
	if (!existsSync(configPath)) throw new Error(`resume_config.json not found at ${configPath}`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(configPath, "utf-8"));
	} catch (error) {
		throw new Error(`Failed to parse ${configPath}: ${error instanceof Error ? error.message : error}`);
	}
	assertResumeConfig(parsed);

	const resolvedCityCountryMap: Record<string, string> = {};
	if (parsed.city_country_map_file) {
		const cityCountryMapPath = join(modelPath, parsed.city_country_map_file);
		if (existsSync(cityCountryMapPath)) {
			let data: Record<string, Record<string, string>>;
			try {
				data = JSON.parse(readFileSync(cityCountryMapPath, "utf-8"));
			} catch (error) {
				throw new Error(`Failed to parse ${cityCountryMapPath}: ${error instanceof Error ? error.message : error}`);
			}
			for (const region of Object.values(data)) {
				Object.assign(resolvedCityCountryMap, region);
			}
		}
	}
	if (Object.keys(resolvedCityCountryMap).length === 0 && parsed.city_country_map) {
		Object.assign(resolvedCityCountryMap, parsed.city_country_map);
	}

	return {
		...parsed,
		city_country_map: resolvedCityCountryMap,
	};
}

export function loadCompanies(modelPath: string): Set<string> {
	const companies = new Set<string>();
	const companiesPath = join(modelPath, "companies.json");
	if (!existsSync(companiesPath)) return companies;

	let data: Record<string, string[]>;
	try {
		data = JSON.parse(readFileSync(companiesPath, "utf-8"));
	} catch (error) {
		throw new Error(`Failed to parse ${companiesPath}: ${error instanceof Error ? error.message : error}`);
	}
	for (const bucket of Object.values(data)) {
		for (const company of bucket) {
			companies.add(company.toLowerCase());
		}
	}
	return companies;
}
