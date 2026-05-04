import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { computeATSScore, parseResume } from "./index";
import { resetRuntimeStateForTests } from "./runtime";

const MODEL = process.env.MODEL_PATH || resolve(import.meta.dir, "../../resume-ner");

const mockedResults: Array<{
	entity?: string;
	word?: string;
	start?: number;
	end?: number;
	score?: number;
}> = [];
const seenPipelineInputs: string[] = [];

let mockedModelDir = "";

function token(entity: string, word: string, start: number, end: number) {
	return { entity, word, start, end, score: 1 };
}

function writeMockModelDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "resume-extract-model-"));
	writeFileSync(
		join(dir, "resume_config.json"),
		JSON.stringify(
			{
				seniority_keywords: {
					Executive: ["chief"],
					Principal: ["principal"],
					Staff: ["staff"],
					Senior: ["senior", "lead"],
					Mid: ["mid"],
					Junior: ["junior", "associate"],
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
				},
				country_name_aliases: {
					bharat: "India",
					usa: "United States",
				},
				pre_processing: {
					normalize_dashes: true,
					normalize_bullets: true,
					collapse_multi_spaces: true,
					strip_labels: ["Phone:", "Email:"],
					bullet_chars: ["●", "•", "▪", "■", "▸", "►", "‣", "⁃"],
					bullet_replacement: "- ",
					dash_replacements: {
						"–": "-",
						"—": "-",
					},
					expand_skill_tables: true,
					skill_table_categories: ["Technical Skills"],
					table_prose_max_words: 15,
					table_continuation_max_chars: 60,
				},
				multi_word_skills: ["machine learning"],
				post_processing: {
					span_merge_max_gap: 3,
					span_merge_labels: ["TITLE", "COMPANY"],
					company_gazetteer_match_max_words: 2,
					title_company_separators: [" at "],
					max_experience_months: 600,
					present_words: ["present", "current"],
					date_words: ["january", "present", "current"],
					space_collapse_pairs: [
						[" . ", "."],
						[" + + ", "++"],
						[" + +", "++"],
						[" & ", "&"],
						[" / ", "/"],
						[" # ", "#"],
						[" ,", ","],
					],
					entity_rules: {
						COMPANY: {
							min_length: 4,
							exceptions: [],
							gazetteer_bypass: true,
							strip_trailing_state_code: true,
						},
						TITLE: {
							min_length: 2,
							exceptions: ["VP", "QA"],
						},
						SKILL: {
							min_length: 4,
							uppercase_bypass: true,
							exceptions: ["Go", "R", "C", "C#", "F#", "D", "C++", "cpp"],
							blocked_words: ["native"],
							aliases: {
								"node js": "node.js",
								cpp: "c++",
							},
						},
						CERT: {
							min_length: 2,
							exceptions: [],
							aliases: {
								"servsafe manager": "servsafe manager certification",
							},
						},
						DATE: {
							min_length: 3,
							exceptions: [],
						},
						EMAIL: {
							min_length: 5,
							exceptions: [],
							require: "@",
							reject_patterns: ["//", "www."],
							strip_prefixes: ["Dr."],
						},
					},
				},
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(dir, "companies.json"),
		JSON.stringify(
			{
				tech: ["Acme", "Globex"],
			},
			null,
			2,
		),
	);
	return dir;
}

describe("parseResume", () => {
	test("parses clean structured resume text", async () => {
		const text = `Rajesh Kumar
rajesh.kumar@gmail.com | +91 98765 43210 | Bangalore, India

Senior Software Engineer
Infosys
April 2020 - Present

Software Engineer
TCS
June 2016 - March 2020

Wipro
Software Developer
July 2014 - May 2016

B.Tech in Computer Science from IIT Madras, 2014

Skills: Java, Spring Boot, Kafka, Python, React, AWS, Docker, Kubernetes`;

		const result = await parseResume(text, MODEL);
		const ats = computeATSScore(result);

		expect(result.personal.name).toBe("Rajesh Kumar");
		expect(result.personal.email).toBe("rajesh.kumar@gmail.com");
		expect(result.country).toBe("India");
		expect(result.seniority).toBe("Senior");
		expect(result.skills).toContain("Spring Boot");
		expect(result.experience.length).toBeGreaterThanOrEqual(2);
		expect(ats.score).toBeGreaterThan(80);
	});
});

describe("config-driven post-processing", () => {
	beforeAll(async () => {
		mockedModelDir = writeMockModelDir();
		mock.module("@huggingface/transformers", () => ({
			pipeline: async () => async (text: string) => {
				seenPipelineInputs.push(text);
				return mockedResults;
			},
		}));
		resetRuntimeStateForTests();
	});

	afterAll(() => {
		resetRuntimeStateForTests();
		mock.restore();
		if (mockedModelDir) rmSync(mockedModelDir, { recursive: true, force: true });
	});

	test("matches the structured resume regression flow from resume-ner", async () => {
		seenPipelineInputs.splice(0, seenPipelineInputs.length);
		mockedResults.splice(
			0,
			mockedResults.length,
			token("B-NAME", "Jane", 0, 4),
			token("I-NAME", "Doe", 5, 8),
			token("B-EMAIL", "jane@example.com", 9, 25),
			token("B-PHONE", "+1", 26, 28),
			token("I-PHONE", "5551234567", 29, 39),
			token("B-LOCATION", "Seattle,", 40, 48),
			token("I-LOCATION", "WA", 49, 51),
			token("B-TITLE", "Engineer", 52, 60),
			token("B-COMPANY", "Acme", 61, 65),
			token("B-DATE", "January", 66, 73),
			token("I-DATE", "2020", 74, 78),
			token("B-DATE", "Present", 79, 86),
		);

		const parsed = await parseResume("Jane Doe regression sample", mockedModelDir);

		expect(parsed.personal.name).toBe("Jane Doe");
		expect(parsed.personal.email).toBe("jane@example.com");
		expect(parsed.experience[0]).toMatchObject({
			title: "Engineer",
			company: "Acme",
			start_date: "January 2020",
			end_date: "Present",
		});
		expect(parsed.country).toBe("United States");
	});

	test("uses config for aliases, country inference, company cleanup, skill merging, and floored years", async () => {
		seenPipelineInputs.splice(0, seenPipelineInputs.length);
		mockedResults.splice(
			0,
			mockedResults.length,
			token("B-NAME", "Jane", 0, 4),
			token("I-NAME", "Doe", 5, 8),
			token("B-EMAIL", "Dr.", 9, 12),
			token("I-EMAIL", "jane@example.com", 13, 29),
			token("B-PHONE", "+91", 30, 33),
			token("I-PHONE", "9999999999", 34, 44),
			token("B-LOCATION", "Bharat", 45, 51),
			token("B-TITLE", "Acme", 52, 56),
			token("I-TITLE", "Engineer", 57, 65),
			token("B-DATE", "January", 66, 73),
			token("I-DATE", "2020", 74, 78),
			token("B-DATE", "June", 79, 83),
			token("I-DATE", "2022", 84, 88),
			token("B-COMPANY", "Globex", 89, 95),
			token("I-COMPANY", "January", 96, 103),
			token("I-COMPANY", "2020", 104, 108),
			token("B-SKILL", "machine", 109, 116),
			token("B-SKILL", "learning", 117, 125),
			token("B-SKILL", "node", 126, 130),
			token("I-SKILL", "js", 131, 133),
			token("B-SKILL", "cpp", 134, 137),
			token("B-CERT", "ServSafe", 138, 146),
			token("I-CERT", "Manager", 147, 154),
		);

		const parsed = await parseResume("Config driven sample", mockedModelDir);

		expect(parsed.personal.email).toBe("jane@example.com");
		expect(parsed.country).toBe("India");
		expect(parsed.experience[0]).toMatchObject({
			title: "Engineer",
			company: "Acme",
			start_date: "January 2020",
			end_date: "June 2022",
		});
		expect(parsed.experience[1]?.company).toBe("Globex");
		expect(parsed.skills).toEqual(["machine learning", "node.js", "c++"]);
		expect(parsed.certifications).toEqual(["servsafe manager certification"]);
		expect(parsed.experience_years).toBe(2);
	});

	test("preprocesses resume text before NER and preserves the original raw text", async () => {
		seenPipelineInputs.splice(0, seenPipelineInputs.length);
		mockedResults.splice(0, mockedResults.length);

		const rawText =
			"Email: jane@example.com\r\nPhone: +1 555 123 4567\r\n● Built APIs\r\nTechnical Skills React,  Node.js";
		const parsed = await parseResume(rawText, mockedModelDir);

		expect(seenPipelineInputs).toEqual([
			"jane@example.com\n+1 555 123 4567\n- Built APIs\nTechnical Skills: React, Node.js",
		]);
		expect(parsed._rawText).toBe(rawText);
	});
});
