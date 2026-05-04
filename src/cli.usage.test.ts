import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "./cli";
import { getModelDownloadTarget } from "./model-bootstrap";
import { resetRuntimeStateForTests } from "./runtime";

const mockedResults: Array<{
	entity?: string;
	word?: string;
	start?: number;
	end?: number;
	score?: number;
}> = [];

function token(entity: string, word: string, start: number, end: number) {
	return { entity, word, start, end, score: 1 };
}

function writeMockModelDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "resume-extract-cli-usage-model-"));
	const requiredFiles = getModelDownloadTarget().requiredFiles;
	const config = {
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
		},
		country_name_aliases: {
			usa: "United States",
		},
		multi_word_skills: [],
		post_processing: {
			span_merge_max_gap: 3,
			span_merge_labels: ["TITLE", "COMPANY"],
			company_gazetteer_match_max_words: 2,
			title_company_separators: [" at "],
			max_experience_months: 600,
			present_words: ["present", "current"],
			date_words: ["present", "current"],
			space_collapse_pairs: [],
			entity_rules: {
				COMPANY: { min_length: 2, gazetteer_bypass: true, strip_trailing_state_code: true },
				TITLE: { min_length: 2, exceptions: [] },
				SKILL: { min_length: 2, exceptions: [] },
				CERT: { min_length: 2, exceptions: [] },
				DATE: { min_length: 3, exceptions: [] },
				EMAIL: { min_length: 5, require: "@", strip_prefixes: [] },
			},
		},
	};

	for (const file of requiredFiles) {
		const path = join(dir, file);
		mkdirSync(dirname(path), { recursive: true });
		if (file === "resume_config.json") {
			writeFileSync(path, JSON.stringify(config, null, 2));
			continue;
		}
		if (file === "companies.json") {
			writeFileSync(path, JSON.stringify({ tech: ["Acme"] }, null, 2));
			continue;
		}
		if (file.endsWith(".json")) {
			writeFileSync(path, "{}");
			continue;
		}
		writeFileSync(path, "test");
	}

	return dir;
}

async function runCli(argv: string[]) {
	let stdout = "";
	let stderr = "";
	const originalStdout = process.stdout.write.bind(process.stdout);
	const originalStderr = process.stderr.write.bind(process.stderr);

	process.stdout.write = ((chunk: string | Uint8Array) => {
		stdout += chunk.toString();
		return true;
	}) as typeof process.stdout.write;
	process.stderr.write = ((chunk: string | Uint8Array) => {
		stderr += chunk.toString();
		return true;
	}) as typeof process.stderr.write;

	try {
		await main(["node", "resume-extract", ...argv]);
		return { stdout, stderr };
	} finally {
		process.stdout.write = originalStdout;
		process.stderr.write = originalStderr;
	}
}

describe("cli actual usage", () => {
	afterEach(() => {
		mock.restore();
		resetRuntimeStateForTests();
		mockedResults.splice(0, mockedResults.length);
	});

	test("extracts structured data from a text file via the CLI", async () => {
		const modelDir = writeMockModelDir();
		const inputFile = join(tmpdir(), `resume-${Date.now()}.txt`);
		writeFileSync(inputFile, "Jane Doe resume text");

		mock.module("@huggingface/transformers", () => ({
			pipeline: async () => async () => mockedResults,
		}));
		mockedResults.push(
			token("B-NAME", "Jane", 0, 4),
			token("I-NAME", "Doe", 5, 8),
			token("B-EMAIL", "jane@example.com", 9, 25),
			token("B-PHONE", "+1", 26, 28),
			token("I-PHONE", "5551234567", 29, 39),
			token("B-LOCATION", "Seattle", 40, 47),
		);

		try {
			const result = await runCli([inputFile, "--model", modelDir, "--view", "json"]);
			const payload = JSON.parse(result.stdout);
			expect(payload.parsed.personal.name).toBe("Jane Doe");
			expect(payload.parsed.personal.email).toBe("jane@example.com");
			expect(payload.parsed.country).toBe("United States");
		} finally {
			rmSync(modelDir, { recursive: true, force: true });
			rmSync(inputFile, { force: true });
		}
	});

	test("accepts PDF input through the CLI", async () => {
		const modelDir = writeMockModelDir();
		const inputFile = join(tmpdir(), `resume-${Date.now()}.pdf`);
		writeFileSync(inputFile, "fake-pdf");

		mock.module("@huggingface/transformers", () => ({
			pipeline: async () => async () => mockedResults,
		}));
		mock.module("@kreuzberg/node", () => ({
			extractFileSync: () => ({ content: "PDF resume text" }),
		}));
		mockedResults.push(
			token("B-NAME", "Jane", 0, 4),
			token("I-NAME", "Doe", 5, 8),
			token("B-EMAIL", "jane@example.com", 9, 25),
		);

		try {
			const result = await runCli([inputFile, "--model", modelDir, "--view", "json"]);
			const payload = JSON.parse(result.stdout);
			expect(payload.parsed.personal.name).toBe("Jane Doe");
			expect(payload.parsed.personal.email).toBe("jane@example.com");
		} finally {
			rmSync(modelDir, { recursive: true, force: true });
			rmSync(inputFile, { force: true });
		}
	});

	test("accepts DOCX input through the CLI", async () => {
		const modelDir = writeMockModelDir();
		const inputFile = join(tmpdir(), `resume-${Date.now()}.docx`);
		writeFileSync(inputFile, "fake-docx");

		mock.module("@huggingface/transformers", () => ({
			pipeline: async () => async () => mockedResults,
		}));
		mock.module("@kreuzberg/node", () => ({
			extractFileSync: () => ({ content: "DOCX resume text" }),
		}));
		mockedResults.push(
			token("B-NAME", "Jane", 0, 4),
			token("I-NAME", "Doe", 5, 8),
			token("B-EMAIL", "jane@example.com", 9, 25),
		);

		try {
			const result = await runCli([inputFile, "--model", modelDir, "--view", "json", "--ats"]);
			const payload = JSON.parse(result.stdout);
			expect(payload.parsed.personal.name).toBe("Jane Doe");
			expect(payload.ats).toBeDefined();
		} finally {
			rmSync(modelDir, { recursive: true, force: true });
			rmSync(inputFile, { force: true });
		}
	});
});
