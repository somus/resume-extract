import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildDoctorReport,
	buildInternalCliCommand,
	collectBatchInputs,
	filterSuppressedOcrWarnings,
	resolveBatchOptions,
	resolveExtractOptions,
} from "./cli";
import { buildStructuredOutput, renderBatchPretty, renderExtractPretty } from "./cli-render";

describe("cli helpers", () => {
	afterEach(() => {
		mock.restore();
	});

	test("resolves extract options with defaults", () => {
		const resolved = resolveExtractOptions(undefined, {
			text: "hello",
			ats: true,
			compact: true,
			model: "./model",
		});

		expect(resolved.modelPath).toBe("./model");
		expect(resolved.allowDownload).toBe(true);
		expect(resolved.inlineText).toBe("hello");
		expect(resolved.includeAts).toBe(true);
		expect(resolved.prettyJson).toBe(false);
	});

	test("resolves batch options with directory scanning and output defaults", () => {
		const resolved = resolveBatchOptions([], {
			inputDir: "./resumes",
			output: "./batch.jsonl",
			modelRepo: "acme/model",
			modelRevision: "dev",
			noDownload: true,
			concurrency: "8",
		});

		expect(resolved.inputDir).toBe("./resumes");
		expect(resolved.outputFormat).toBe("jsonl");
		expect(resolved.modelRepo).toBe("acme/model");
		expect(resolved.modelRevision).toBe("dev");
		expect(resolved.allowDownload).toBe(false);
		expect(resolved.concurrency).toBe(8);
	});

	test("supports csv batch output", () => {
		const resolved = resolveBatchOptions(["./one.pdf"], {
			outputFormat: "csv",
			failFast: true,
		});

		expect(resolved.outputFormat).toBe("csv");
		expect(resolved.failFast).toBe(true);
	});

	test("collects supported batch inputs from files and directories", async () => {
		const dir = mkdtempSync(join(tmpdir(), "resume-extract-batch-"));
		try {
			writeFileSync(join(dir, "one.txt"), "hello");
			writeFileSync(join(dir, "two.pdf"), "fake");
			writeFileSync(join(dir, "skip.png"), "fake");
			mkdirSync(join(dir, "nested"), { recursive: true });
			writeFileSync(join(dir, "nested", "three.docx"), "fake");

			const files = await collectBatchInputs([dir], {
				inputDir: undefined,
				glob: "**/*",
			});

			expect(files.map((file) => file.split("/").pop())).toEqual(["three.docx", "one.txt", "two.pdf"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("builds jsonl structured output", () => {
		const output = buildStructuredOutput([{ input: "a.txt", error: "bad" }], "jsonl", false);
		expect(output).toBe('{"input":"a.txt","error":"bad"}');
	});

	test("builds csv structured output", () => {
		const output = buildStructuredOutput(
			[
				{
					input: "/tmp/a.txt",
					parsed: {
						personal: { name: "Jane", email: "jane@example.com", phone: null, location: "Seattle" },
						experience: [{ title: "Engineer", company: "Acme", start_date: "2020", end_date: "Present" }],
						education: [{ degree: "B.Tech", field: "CS", institution: "IIT" }],
						skills: ["TypeScript", "AWS"],
						certifications: ["AWS Cert"],
						seniority: "Senior",
						country: "United States",
						experience_years: 5,
						_rawText: "",
					},
					ats: { score: 88, details: {}, issues: [] },
				},
			],
			"csv",
			false,
		);

		expect(output).toContain(
			"input,status,name,email,phone,location,country,seniority,experience_years,experience_count,education_count,experience_summary,education_summary,skills,certifications,ats_score,error,exp_1_title,exp_1_company,exp_1_start_date,exp_1_end_date,edu_1_degree,edu_1_field,edu_1_institution",
		);
		expect(output).toContain("/tmp/a.txt,ok,Jane,jane@example.com");
		expect(output).toContain("1,1,");
		expect(output).toContain("Engineer @ Acme (2020 -> Present)");
		expect(output).toContain("B.Tech | CS | IIT");
		expect(output).toContain("TypeScript; AWS");
		expect(output).toContain(",Engineer,Acme,2020,Present,B.Tech,CS,IIT");
	});

	test("renders readable pretty output", () => {
		const extractView = renderExtractPretty({
			input: "/tmp/resume.txt",
			parsed: {
				personal: { name: "Jane Doe", email: "jane@example.com", phone: null, location: "Seattle" },
				experience: [{ title: "Engineer", company: "Acme", start_date: "2020", end_date: "Present" }],
				education: [{ degree: "B.Tech", field: "CS", institution: "IIT" }],
				skills: ["TypeScript", "AWS"],
				certifications: [],
				seniority: "Senior",
				country: "United States",
				experience_years: 4,
				_rawText: "",
			},
			ats: { score: 88, details: {}, issues: [] },
		});
		const batchView = renderBatchPretty([
			{
				input: "/tmp/one.txt",
				parsed: {
					personal: { name: null, email: null, phone: null, location: null },
					experience: [],
					education: [],
					skills: [],
					certifications: [],
					seniority: "Junior",
					country: null,
					experience_years: null,
					_rawText: "",
				},
			},
			{ input: "/tmp/two.txt", error: "boom" },
		]);

		expect(extractView).toContain("Personal");
		expect(extractView).toContain("ATS");
		expect(batchView).toContain("Processed 2 file(s): 1 succeeded, 1 failed");
		expect(batchView).toContain("two.txt");
	});

	test("builds doctor report with inspection details", async () => {
		const dir = mkdtempSync(join(tmpdir(), "resume-extract-doctor-"));
		try {
			const report = await buildDoctorReport({
				model: dir,
				ocr: false,
			});

			expect(report.modelPath).toContain("resume-extract-doctor-");
			expect(report.modelReady).toBe(false);
			expect(report.missingFiles.length).toBeGreaterThan(0);
			expect(report.zeroByteFiles).toEqual([]);
			expect(report.invalidJsonFiles).toEqual([]);
			expect(report.writable).toBe(true);
			expect(report.tesseract).toBe("not_checked");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("filters known Tesseract object cache leak warnings while keeping real stderr", () => {
		const stderr = [
			"ObjectCache(0x1)::~ObjectCache(): WARNING! LEAK! object 0x2 still has count 2 (id /opt/homebrew/share/tessdata/eng.traineddatalstm-punc-dawg)",
			"real error line",
			"ObjectCache(0x3)::~ObjectCache(): WARNING! LEAK! object 0x4 still has count 2 (id /opt/homebrew/share/tessdata/eng.traineddatalstm-word-dawg)",
		].join("\n");

		expect(filterSuppressedOcrWarnings(stderr)).toBe("real error line");
	});

	test("builds internal CLI worker commands for source execution", () => {
		const originalArgv = process.argv;
		process.argv = ["/path/to/bun", "/repo/src/cli.ts"];
		try {
			expect(buildInternalCliCommand(["__internal-pdf-ocr-extract", "/tmp/file.pdf"])).toEqual([
				process.execPath,
				"/repo/src/cli.ts",
				"__internal-pdf-ocr-extract",
				"/tmp/file.pdf",
			]);
		} finally {
			process.argv = originalArgv;
		}
	});
});
