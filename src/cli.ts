#!/usr/bin/env bun

import { accessSync, constants, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { cac } from "cac";
import {
	buildStructuredOutput,
	type CliBatchItemResult,
	type CliExtractResult,
	renderBatchPretty,
	renderExtractPretty,
} from "./cli-render";
import { computeATSScore, extractTextFromPdf, parseResume, parseResumeDocx, parseResumePdf } from "./index";
import {
	checkForModelUpdate,
	ensureModelReady,
	getDefaultModelPath,
	getModelDownloadTarget,
	inspectModelFiles,
	isModelReady,
	updateModel,
} from "./model-bootstrap";
import type { ParsedResume, PdfTextExtractionOptions } from "./types";

export type InputFormat = "auto" | "text" | "pdf" | "docx";
export type ViewMode = "json" | "pretty";
export type BatchOutputFormat = "json" | "jsonl" | "csv";

interface CommonCommandOptions {
	model?: string;
	modelRepo?: string;
	modelRevision?: string;
	noDownload?: boolean;
	ocr?: boolean;
	ocrBackend?: string;
	ocrLanguage?: string;
	ocrDpi?: number;
	ats?: boolean;
}

interface ExtractCommandOptions extends CommonCommandOptions {
	input?: string;
	text?: string;
	format?: InputFormat;
	output?: string;
	view?: ViewMode;
	compact?: boolean;
}

interface ResolvedExtractCommandOptions {
	modelPath: string;
	modelRepo?: string;
	modelRevision?: string;
	allowDownload: boolean;
	inputPath?: string;
	inlineText?: string;
	inputFormat: InputFormat;
	outputPath?: string;
	includeAts: boolean;
	view: ViewMode;
	prettyJson: boolean;
	ocrOptions?: PdfTextExtractionOptions;
}

interface BatchCommandOptions extends CommonCommandOptions {
	inputDir?: string;
	glob?: string;
	output?: string;
	outputFormat?: BatchOutputFormat;
	view?: ViewMode;
	concurrency?: number | string;
	compact?: boolean;
	failFast?: boolean;
}

interface ResolvedBatchCommandOptions {
	modelPath: string;
	modelRepo?: string;
	modelRevision?: string;
	allowDownload: boolean;
	inputDir?: string;
	glob: string;
	outputPath?: string;
	outputFormat: BatchOutputFormat;
	view: ViewMode;
	includeAts: boolean;
	prettyJson: boolean;
	concurrency: number;
	ocrOptions?: PdfTextExtractionOptions;
	failFast: boolean;
}

interface OptionCommand<T> {
	option(name: string, description?: string, config?: { default?: unknown }): T;
}

interface SetupModelCommandOptions {
	model?: string;
	modelRepo?: string;
	modelRevision?: string;
}

interface DoctorCommandOptions {
	model?: string;
	modelRepo?: string;
	modelRevision?: string;
	ocr?: boolean;
	fix?: boolean;
	json?: boolean;
}

export interface DoctorReport {
	modelPath: string;
	modelReady: boolean;
	modelRepo: string;
	modelRevision: string;
	requiredFiles: number;
	missingFiles: string[];
	zeroByteFiles: string[];
	invalidJsonFiles: string[];
	writableCheckPath: string;
	writable: boolean;
	writableReason: string;
	ocrRequested: boolean;
	platform: string;
	bunVersion: string;
	tesseract: string;
}

const INTERNAL_PDF_OCR_COMMAND = "__internal-pdf-ocr-extract";
const OCR_WARNING_PATTERN = /^ObjectCache\(.*WARNING! LEAK!.*$/gm;

function fail(message: string): never {
	throw new Error(message);
}

function detectFormat(inputPath: string): Exclude<InputFormat, "auto"> {
	switch (extname(inputPath).toLowerCase()) {
		case ".pdf":
			return "pdf";
		case ".docx":
			return "docx";
		default:
			return "text";
	}
}

export function buildInternalCliCommand(args: string[]): string[] {
	const scriptPath = process.argv[1];
	if (scriptPath && /\.(?:[cm]?[jt]s|tsx?)$/i.test(scriptPath)) {
		return [process.execPath, scriptPath, ...args];
	}
	return [process.execPath, ...args];
}

export function filterSuppressedOcrWarnings(stderr: string): string {
	return stderr
		.replace(OCR_WARNING_PATTERN, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function toOcrOptions(options: CommonCommandOptions): PdfTextExtractionOptions | undefined {
	if (!options.ocr && !options.ocrBackend && !options.ocrLanguage && !options.ocrDpi) return undefined;
	const backend = options.ocrBackend || "tesseract";
	if (backend !== "tesseract" && backend !== "easyocr" && backend !== "paddleocr") {
		fail("Invalid --ocr-backend value. Use tesseract, easyocr, or paddleocr.");
	}
	return {
		ocr: {
			backend,
			language: options.ocrLanguage || "eng",
			dpi: options.ocrDpi || 150,
		},
	};
}

function normalizeView(view: string | undefined, defaultView: ViewMode): ViewMode {
	if (!view) return defaultView;
	if (view !== "json" && view !== "pretty") {
		fail("Invalid --view value. Use json or pretty.");
	}
	return view;
}

function normalizeBatchOutputFormat(format: string | undefined, defaultFormat: BatchOutputFormat): BatchOutputFormat {
	if (!format) return defaultFormat;
	if (format !== "json" && format !== "jsonl" && format !== "csv") {
		fail("Invalid --output-format value. Use json, jsonl, or csv.");
	}
	return format;
}

function normalizeInputFormat(format: string | undefined): InputFormat {
	if (!format) return "auto";
	if (!["auto", "text", "pdf", "docx"].includes(format)) {
		fail("Invalid --format value. Use auto, text, pdf, or docx.");
	}
	return format as InputFormat;
}

function normalizeConcurrency(value: number | string | undefined): number {
	if (value == null) return 4;
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) {
		fail("Invalid --concurrency value. Use a positive integer.");
	}
	return Math.floor(parsed);
}

async function readStdin(): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf-8");
}

export function resolveExtractOptions(
	positionalInput: string | undefined,
	options: ExtractCommandOptions,
): ResolvedExtractCommandOptions {
	const inputPath = options.input || positionalInput;
	const inlineText = options.text;
	if (inputPath && inlineText) {
		fail("Use either an input path or --text, not both.");
	}
	if (!inputPath && !inlineText && process.stdin.isTTY) {
		fail("Provide an input path, --text, or pipe resume text via stdin.");
	}

	return {
		modelPath: options.model || getDefaultModelPath(),
		modelRepo: options.modelRepo,
		modelRevision: options.modelRevision,
		allowDownload: !options.noDownload,
		inputPath,
		inlineText,
		inputFormat: normalizeInputFormat(options.format),
		outputPath: options.output,
		includeAts: Boolean(options.ats),
		view: normalizeView(options.view, process.stdout.isTTY ? "pretty" : "json"),
		prettyJson: !options.compact,
		ocrOptions: toOcrOptions(options),
	};
}

export function resolveBatchOptions(inputs: string[], options: BatchCommandOptions): ResolvedBatchCommandOptions {
	if (inputs.length === 0 && !options.inputDir) {
		fail("Provide at least one input path or use --input-dir for batch mode.");
	}

	return {
		modelPath: options.model || getDefaultModelPath(),
		modelRepo: options.modelRepo,
		modelRevision: options.modelRevision,
		allowDownload: !options.noDownload,
		inputDir: options.inputDir,
		glob: options.glob || "**/*",
		outputPath: options.output,
		outputFormat: normalizeBatchOutputFormat(options.outputFormat, options.output ? "jsonl" : "json"),
		view: normalizeView(options.view, process.stdout.isTTY ? "pretty" : "json"),
		includeAts: Boolean(options.ats),
		prettyJson: !options.compact,
		concurrency: normalizeConcurrency(options.concurrency),
		ocrOptions: toOcrOptions(options),
		failFast: Boolean(options.failFast),
	};
}

export async function parseInput(
	input: { inputPath?: string; inlineText?: string; inputFormat: InputFormat; ocrOptions?: PdfTextExtractionOptions },
	modelPath: string,
): Promise<ParsedResume> {
	if (input.inlineText) {
		return await parseResume(input.inlineText, modelPath);
	}

	if (!input.inputPath) {
		const text = await readStdin();
		return await parseResume(text, modelPath);
	}

	const inputPath = resolve(input.inputPath);
	const format = input.inputFormat === "auto" ? detectFormat(inputPath) : input.inputFormat;
	if (format === "pdf") {
		if (input.ocrOptions?.ocr) {
			const text = await extractPdfTextViaWorker(inputPath, input.ocrOptions);
			return await parseResume(text, modelPath);
		}
		return await parseResumePdf(inputPath, modelPath, input.ocrOptions);
	}
	if (format === "docx") {
		return await parseResumeDocx(inputPath, modelPath);
	}

	const text = readFileSync(inputPath, "utf-8");
	return await parseResume(text, modelPath);
}

async function extractPdfTextViaWorker(inputPath: string, options?: PdfTextExtractionOptions): Promise<string> {
	const backend = typeof options?.ocr === "object" && options.ocr.backend ? options.ocr.backend : "tesseract";
	const language = typeof options?.ocr === "object" && options.ocr.language ? options.ocr.language : "eng";
	const dpi = typeof options?.ocr === "object" && options.ocr.dpi ? String(options.ocr.dpi) : "150";

	const command = buildInternalCliCommand([INTERNAL_PDF_OCR_COMMAND, inputPath, backend, language, dpi]);
	const child = Bun.spawn({
		cmd: command,
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);

	const filteredStderr = filterSuppressedOcrWarnings(stderr);
	if (filteredStderr) {
		process.stderr.write(`${filteredStderr}\n`);
	}

	if (exitCode !== 0) {
		throw new Error(filteredStderr || stdout || `OCR worker failed with exit code ${exitCode}`);
	}

	const payload = JSON.parse(stdout) as { text?: string };
	if (!payload.text || payload.text.trim().length === 0) {
		throw new Error("OCR worker returned empty text");
	}
	return payload.text;
}

function isSupportedFile(path: string): boolean {
	const extension = extname(path).toLowerCase();
	return [".pdf", ".docx", ".txt"].includes(extension);
}

export async function collectBatchInputs(
	explicitInputs: string[],
	options: Pick<ResolvedBatchCommandOptions, "inputDir" | "glob">,
): Promise<string[]> {
	const resolved = new Set<string>();

	for (const input of explicitInputs) {
		const path = resolve(input);
		if (!existsSync(path)) {
			fail(`Input path not found: ${input}`);
		}
		if (statSync(path).isDirectory()) {
			const glob = new Bun.Glob(options.glob);
			for await (const entry of glob.scan({ cwd: path, onlyFiles: true, absolute: true })) {
				if (isSupportedFile(entry)) resolved.add(entry);
			}
		} else {
			resolved.add(path);
		}
	}

	if (options.inputDir) {
		const inputDir = resolve(options.inputDir);
		if (!existsSync(inputDir) || !statSync(inputDir).isDirectory()) {
			fail(`--input-dir must point to an existing directory: ${options.inputDir}`);
		}
		const glob = new Bun.Glob(options.glob);
		for await (const entry of glob.scan({ cwd: inputDir, onlyFiles: true, absolute: true })) {
			if (isSupportedFile(entry)) resolved.add(entry);
		}
	}

	return [...resolved].sort();
}

function writeOutput(path: string | undefined, content: string) {
	if (path) {
		writeFileSync(resolve(path), content);
		return;
	}
	process.stdout.write(`${content}\n`);
}

function commandModelPath(model: string | undefined): string {
	return resolve(model || getDefaultModelPath());
}

function commandDownloadTarget(options: { modelRepo?: string; modelRevision?: string }) {
	return getModelDownloadTarget({
		repoId: options.modelRepo,
		revision: options.modelRevision,
	});
}

function showBatchProgress(current: number, total: number, input: string, isError: boolean) {
	const prefix = isError ? "ERR" : "OK ";
	const line = `[${current}/${total}] ${prefix} ${input}`;
	if (process.stderr.isTTY) {
		process.stderr.write(`\r${line.padEnd(120)}`);
		if (current === total) process.stderr.write("\n");
	} else {
		process.stderr.write(`${line}\n`);
	}
}

async function runWithConcurrency<TInput, TResult>(
	inputs: TInput[],
	concurrency: number,
	task: (input: TInput, index: number) => Promise<TResult>,
	onSettled?: (input: TInput, index: number, result: TResult) => void,
): Promise<TResult[]> {
	const results = new Array<TResult>(inputs.length);
	let nextIndex = 0;
	let aborted = false;

	async function worker() {
		while (true) {
			if (aborted) return;
			const current = nextIndex;
			nextIndex += 1;
			if (current >= inputs.length) return;
			try {
				const result = await task(inputs[current], current);
				results[current] = result;
				onSettled?.(inputs[current], current, result);
			} catch (error) {
				aborted = true;
				throw error;
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
	return results;
}

async function warnIfModelOutdated(modelPath: string, repoId?: string, revision?: string) {
	try {
		const result = await checkForModelUpdate(modelPath, repoId, revision);
		if (result?.updateAvailable) {
			process.stderr.write(
				`\x1b[33m⚠ A newer model is available on Hugging Face. Run \`resume-extract update-model\` to update.\x1b[0m\n`,
			);
		}
	} catch {}
}

async function runExtract(positionalInput: string | undefined, options: ExtractCommandOptions) {
	const resolved = resolveExtractOptions(positionalInput, options);
	const modelPath = await ensureModelReady({
		modelPath: resolve(resolved.modelPath),
		repoId: resolved.modelRepo,
		revision: resolved.modelRevision,
		allowDownload: resolved.allowDownload,
	});
	await warnIfModelOutdated(modelPath, resolved.modelRepo, resolved.modelRevision);
	const parsed = await parseInput(resolved, modelPath);
	const result: CliExtractResult = {
		input: resolved.inputPath ? resolve(resolved.inputPath) : undefined,
		parsed,
		ats: resolved.includeAts ? computeATSScore(parsed) : undefined,
	};

	if (resolved.outputPath) {
		writeOutput(resolved.outputPath, buildStructuredOutput(result, "json", resolved.prettyJson));
		if (resolved.view === "pretty") {
			process.stdout.write(`${renderExtractPretty(result)}\n`);
		}
		return;
	}

	if (resolved.view === "pretty") {
		process.stdout.write(`${renderExtractPretty(result)}\n`);
		return;
	}

	writeOutput(undefined, buildStructuredOutput(result, "json", resolved.prettyJson));
}

async function runBatch(inputs: string[], options: BatchCommandOptions) {
	const resolved = resolveBatchOptions(inputs, options);
	const allInputs = await collectBatchInputs(inputs, resolved);
	if (allInputs.length === 0) {
		fail("No supported input files found for batch mode.");
	}

	const modelPath = await ensureModelReady({
		modelPath: resolve(resolved.modelPath),
		repoId: resolved.modelRepo,
		revision: resolved.modelRevision,
		allowDownload: resolved.allowDownload,
	});
	await warnIfModelOutdated(modelPath, resolved.modelRepo, resolved.modelRevision);

	let completed = 0;
	const results = await runWithConcurrency(
		allInputs,
		resolved.concurrency,
		async (input) => {
			try {
				const parsed = await parseInput(
					{
						inputPath: input,
						inputFormat: "auto",
						ocrOptions: resolved.ocrOptions,
					},
					modelPath,
				);
				return {
					input,
					parsed,
					ats: resolved.includeAts ? computeATSScore(parsed) : undefined,
				} satisfies CliBatchItemResult;
			} catch (error) {
				if (resolved.failFast) {
					throw error;
				}
				return {
					input,
					error: error instanceof Error ? error.message : String(error),
				} satisfies CliBatchItemResult;
			}
		},
		(input, _index, result) => {
			completed += 1;
			showBatchProgress(completed, allInputs.length, input, Boolean(result.error));
		},
	);

	if (resolved.outputPath) {
		writeOutput(resolved.outputPath, buildStructuredOutput(results, resolved.outputFormat, resolved.prettyJson));
		if (resolved.view === "pretty") {
			process.stdout.write(`${renderBatchPretty(results)}\n`);
		}
		return;
	}

	if (resolved.view === "pretty") {
		process.stdout.write(`${renderBatchPretty(results)}\n`);
		return;
	}

	writeOutput(undefined, buildStructuredOutput(results, resolved.outputFormat, resolved.prettyJson));
}

async function runSetupModel(options: SetupModelCommandOptions) {
	const modelPath = await ensureModelReady({
		modelPath: commandModelPath(options.model),
		repoId: options.modelRepo,
		revision: options.modelRevision,
		allowDownload: true,
	});
	process.stdout.write(`Model ready at ${modelPath}\n`);
}

async function runUpdateModel(options: SetupModelCommandOptions) {
	const modelPath = await updateModel({
		modelPath: commandModelPath(options.model),
		repoId: options.modelRepo,
		revision: options.modelRevision,
	});
	process.stdout.write(`Model updated at ${modelPath}\n`);
}

export async function buildDoctorReport(options: DoctorCommandOptions): Promise<DoctorReport> {
	const modelPath = commandModelPath(options.model);
	const target = commandDownloadTarget(options);
	const ready = isModelReady(modelPath);
	const inspection = inspectModelFiles(modelPath);
	const writableTarget = detectWritableTarget(modelPath);
	const tesseract = options.ocr ? (await Bun.which("tesseract")) || "missing" : "not_checked";

	return {
		modelPath,
		modelReady: ready,
		modelRepo: target.repoId,
		modelRevision: target.revision,
		requiredFiles: target.requiredFiles.length,
		missingFiles: inspection.missingFiles,
		zeroByteFiles: inspection.zeroByteFiles,
		invalidJsonFiles: inspection.invalidJsonFiles,
		writableCheckPath: writableTarget.path,
		writable: writableTarget.writable,
		writableReason: writableTarget.reason,
		ocrRequested: Boolean(options.ocr),
		platform: `${process.platform}-${process.arch}`,
		bunVersion: Bun.version,
		tesseract,
	};
}

async function runDoctor(options: DoctorCommandOptions) {
	if (options.fix) {
		await ensureModelReady({
			modelPath: commandModelPath(options.model),
			repoId: options.modelRepo,
			revision: options.modelRevision,
			allowDownload: true,
		});
	}

	const report = await buildDoctorReport(options);
	if (options.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	const checks: Array<[string, string]> = [
		["model_path", report.modelPath],
		["model_ready", report.modelReady ? "yes" : "no"],
		["model_repo", report.modelRepo],
		["model_revision", report.modelRevision],
		["required_files", String(report.requiredFiles)],
		["missing_files", report.missingFiles.length === 0 ? "0" : report.missingFiles.join(", ")],
		["zero_byte_files", report.zeroByteFiles.length === 0 ? "0" : report.zeroByteFiles.join(", ")],
		["invalid_json_files", report.invalidJsonFiles.length === 0 ? "0" : report.invalidJsonFiles.join(", ")],
		["writable_check_path", report.writableCheckPath],
		["writable", report.writable ? "yes" : report.writableReason],
		["ocr_requested", report.ocrRequested ? "yes" : "no"],
		["platform", report.platform],
		["bun_version", report.bunVersion],
	];
	if (options.ocr) {
		checks.push(["tesseract", report.tesseract]);
	}
	const lines = ["resume-extract doctor", "", ...checks.map(([label, value]) => `${label}: ${value}`)];
	if (!report.modelReady) {
		lines.push("", "Model is not fully present. Run: resume-extract setup-model");
	}
	process.stdout.write(`${lines.join("\n")}\n`);
}

function detectWritableTarget(path: string): { path: string; writable: boolean; reason: string } {
	let candidate = existsSync(path) ? path : dirname(path);
	while (!existsSync(candidate)) {
		const parent = dirname(candidate);
		if (parent === candidate) break;
		candidate = parent;
	}

	try {
		accessSync(candidate, constants.W_OK);
		return { path: candidate, writable: true, reason: "yes" };
	} catch (error) {
		return {
			path: candidate,
			writable: false,
			reason: error instanceof Error ? error.message : "not writable",
		};
	}
}

function addCommonOptions<T extends OptionCommand<T>>(command: T): T {
	return command
		.option("--model <path>", "Path to the resume-ner model directory")
		.option("--model-repo <repo>", "Hugging Face repo to download when the model is missing")
		.option("--model-revision <revision>", "Hugging Face revision to download, defaults to main")
		.option("--no-download", "Fail instead of auto-downloading missing model files")
		.option("--ocr", "Enable OCR for PDF input")
		.option("--ocr-backend <backend>", "OCR backend: tesseract, easyocr, or paddleocr")
		.option("--ocr-language <lang>", "OCR language, defaults to eng")
		.option("--ocr-dpi <dpi>", "OCR DPI, defaults to 150")
		.option("--ats", "Include ATS scoring in the output");
}

export function createCli() {
	const cli = cac("resume-extract");

	addCommonOptions(
		cli
			.command("batch [inputs...]", "Extract multiple resumes")
			.option("--input-dir <dir>", "Scan a directory for resumes")
			.option("--glob <pattern>", "Glob pattern for batch scanning, defaults to **/*")
			.option("--concurrency <n>", "Number of files to process concurrently", { default: 4 })
			.option("--fail-fast", "Stop batch processing on the first error")
			.option("--output <path>", "Write structured batch output to a file")
			.option("--output-format <format>", "Structured output format: json, jsonl, or csv")
			.option("--view <view>", "Output view: json or pretty")
			.option("--compact", "Use compact JSON for structured output"),
	).action(async (inputs, options) => {
		await runBatch(inputs, options as BatchCommandOptions);
	});

	cli
		.command("setup-model", "Download and prepare the default model")
		.option("--model <path>", "Path to the resume-ner model directory")
		.option("--model-repo <repo>", "Hugging Face repo to download when the model is missing")
		.option("--model-revision <revision>", "Hugging Face revision to download, defaults to main")
		.action(async (options) => {
			await runSetupModel(options as SetupModelCommandOptions);
		});

	cli
		.command("update-model", "Pull the latest model from Hugging Face")
		.option("--model <path>", "Path to the resume-ner model directory")
		.option("--model-repo <repo>", "Hugging Face repo to pull from")
		.option("--model-revision <revision>", "Hugging Face revision to pull, defaults to main")
		.action(async (options) => {
			await runUpdateModel(options as SetupModelCommandOptions);
		});

	cli
		.command("doctor", "Check local runtime dependencies and model status")
		.option("--model <path>", "Path to the resume-ner model directory")
		.option("--model-repo <repo>", "Expected Hugging Face model repo")
		.option("--model-revision <revision>", "Expected Hugging Face model revision")
		.option("--ocr", "Also check OCR runtime availability")
		.option("--fix", "Download and repair the model before reporting")
		.option("--json", "Emit doctor output as JSON")
		.action(async (options) => {
			await runDoctor(options as DoctorCommandOptions);
		});

	addCommonOptions(
		cli
			.command("[input]", "Extract a single resume")
			.option("--input <path>", "Resume file path")
			.option("--text <text>", "Inline resume text")
			.option("--format <format>", "Force input format: auto, text, pdf, docx")
			.option("--output <path>", "Write structured output to a file")
			.option("--view <view>", "Output view: json or pretty")
			.option("--compact", "Use compact JSON for structured output"),
	).action(async (input, options) => {
		await runExtract(input, options as ExtractCommandOptions);
	});

	cli.help();
	return cli;
}

async function runInternalPdfOcrExtract(argv: string[]) {
	const [, inputPath, backend = "tesseract", language = "eng", dpi = "150"] = argv;
	if (!inputPath) {
		throw new Error("Missing input path for internal OCR extraction");
	}

	const text = await extractTextFromPdf(resolve(inputPath), {
		ocr: {
			backend: backend as "tesseract" | "easyocr" | "paddleocr",
			language,
			dpi: Number(dpi) || 150,
		},
	});
	process.stdout.write(JSON.stringify({ text }));
}

export async function main(argv = process.argv) {
	try {
		const normalizedArgv =
			argv.length > 1 && (argv[0]?.includes("bun") || argv[0]?.includes("node")) ? argv : ["node", ...argv];
		const internalCommand = normalizedArgv[2];
		if (internalCommand === INTERNAL_PDF_OCR_COMMAND) {
			await runInternalPdfOcrExtract(normalizedArgv.slice(2));
			return;
		}

		const cli = createCli();
		cli.parse(normalizedArgv, { run: false });
		await cli.runMatchedCommand();
	} catch (error) {
		const message = `${error instanceof Error ? error.message : String(error)}\n`;
		process.stderr.write(message);
		if (import.meta.main) {
			process.exit(1);
		}
		throw error;
	}
}

if (import.meta.main) {
	await main();
}
