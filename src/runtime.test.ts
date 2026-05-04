import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuntime, resetRuntimeStateForTests } from "./runtime";

function writeRuntimeModelDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "resume-extract-runtime-"));
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
					EMAIL: {},
				},
			},
		}),
	);
	writeFileSync(join(dir, "companies.json"), "{}");
	return dir;
}

describe("runtime loading", () => {
	afterEach(() => {
		mock.restore();
		resetRuntimeStateForTests();
	});

	test("requests the quantized ONNX model explicitly", async () => {
		const dir = writeRuntimeModelDir();
		const calls: Array<{ task: string; modelPath: string; options: Record<string, unknown> }> = [];

		mock.module("@huggingface/transformers", () => ({
			pipeline: async (task: string, modelPath: string, options: Record<string, unknown>) => {
				calls.push({ task, modelPath, options });
				return async () => [];
			},
		}));

		try {
			await loadRuntime(dir);
			expect(calls).toHaveLength(1);
			expect(calls[0]).toMatchObject({
				task: "token-classification",
				modelPath: dir,
				options: {
					dtype: "q8",
					local_files_only: true,
				},
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
