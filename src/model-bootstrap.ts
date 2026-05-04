import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_MODEL_REPO = "oksomu/resume-ner";
const DEFAULT_MODEL_REVISION = "main";
const REQUIRED_MODEL_FILES = [
	"config.json",
	"tokenizer.json",
	"tokenizer_config.json",
	"special_tokens_map.json",
	"vocab.txt",
	"resume_config.json",
	"companies.json",
	"city_country_map.json",
	"onnx/config.json",
	"onnx/model_quantized.onnx",
	"onnx/ort_config.json",
	"onnx/special_tokens_map.json",
	"onnx/tokenizer.json",
	"onnx/tokenizer_config.json",
	"onnx/vocab.txt",
] as const;

export interface ModelBootstrapOptions {
	modelPath: string;
	repoId?: string;
	revision?: string;
	allowDownload?: boolean;
}

export interface ModelDownloadTarget {
	repoId: string;
	revision: string;
	requiredFiles: readonly string[];
}

export interface ModelInspectionResult {
	missingFiles: string[];
	zeroByteFiles: string[];
	invalidJsonFiles: string[];
}

export function getDefaultModelPath(): string {
	const home =
		process.env.HOME ||
		process.env.USERPROFILE ||
		(process.platform === "win32"
			? process.env.LOCALAPPDATA || process.env.APPDATA
			: process.env.XDG_CACHE_HOME || undefined);

	if (!home) {
		throw new Error("Could not determine a default model cache directory. Pass --model explicitly.");
	}

	if (process.platform === "win32") {
		return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "resume-extract", "models", "resume-ner");
	}

	const cacheRoot = process.env.XDG_CACHE_HOME || join(home, ".cache");
	return join(cacheRoot, "resume-extract", "models", "resume-ner");
}

export function isModelReady(modelPath: string): boolean {
	return REQUIRED_MODEL_FILES.every((file) => existsSync(join(modelPath, file)));
}

export function inspectModelFiles(modelPath: string): ModelInspectionResult {
	const missingFiles: string[] = [];
	const zeroByteFiles: string[] = [];
	const invalidJsonFiles: string[] = [];

	for (const file of REQUIRED_MODEL_FILES) {
		const path = join(modelPath, file);
		if (!existsSync(path)) {
			missingFiles.push(file);
			continue;
		}

		const stats = statSync(path);
		if (stats.size === 0) {
			zeroByteFiles.push(file);
		}

		if (file.endsWith(".json")) {
			try {
				JSON.parse(readFileSync(path, "utf-8"));
			} catch {
				invalidJsonFiles.push(file);
			}
		}
	}

	return {
		missingFiles,
		zeroByteFiles,
		invalidJsonFiles,
	};
}

export function getModelDownloadTarget(
	options: Pick<ModelBootstrapOptions, "repoId" | "revision"> = {},
): ModelDownloadTarget {
	return {
		repoId: options.repoId || DEFAULT_MODEL_REPO,
		revision: options.revision || DEFAULT_MODEL_REVISION,
		requiredFiles: REQUIRED_MODEL_FILES,
	};
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderProgress(
	index: number,
	totalFiles: number,
	file: string,
	downloaded: number,
	totalBytes: number | null,
	isTTY: boolean,
) {
	const prefix = `[${index}/${totalFiles}] ${file}`;
	const suffix = totalBytes ? `${formatBytes(downloaded)} / ${formatBytes(totalBytes)}` : formatBytes(downloaded);
	const percent = totalBytes ? ` (${Math.floor((downloaded / totalBytes) * 100)}%)` : "";
	const line = `${prefix} ${suffix}${percent}`;
	if (isTTY) {
		process.stderr.write(`\r${line.padEnd(120)}`);
	} else {
		process.stderr.write(`${line}\n`);
	}
}

async function downloadFile(
	modelPath: string,
	repoId: string,
	revision: string,
	file: string,
	index: number,
	totalFiles: number,
) {
	const url = `https://huggingface.co/${repoId}/resolve/${revision}/${file}`;
	const targetPath = join(modelPath, file);
	mkdirSync(dirname(targetPath), { recursive: true });

	const response = await fetch(url);
	if (!response.ok || !response.body) {
		throw new Error(`Failed to download model file ${file} from ${url} (${response.status})`);
	}

	const totalBytes = Number(response.headers.get("content-length")) || null;
	const isTTY = Boolean(process.stderr.isTTY);
	const writer = createWriteStream(targetPath);
	const reader = response.body.getReader();
	let downloaded = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		writer.write(value);
		downloaded += value.byteLength;
		renderProgress(index, totalFiles, file, downloaded, totalBytes, isTTY);
	}

	await new Promise<void>((resolve, reject) => {
		writer.end((error?: Error | null) => {
			if (error) reject(error);
			else resolve();
		});
	});

	if (isTTY) {
		process.stderr.write("\n");
	}
}

export async function ensureModelReady(options: ModelBootstrapOptions): Promise<string> {
	const modelPath = options.modelPath;
	if (isModelReady(modelPath)) return modelPath;
	if (options.allowDownload === false) {
		throw new Error(`Model files not found at ${modelPath}. Download them first or remove --no-download.`);
	}

	const repoId = options.repoId || DEFAULT_MODEL_REPO;
	const revision = options.revision || DEFAULT_MODEL_REVISION;
	mkdirSync(modelPath, { recursive: true });

	process.stderr.write(`Model not found at ${modelPath}. Downloading ${repoId}@${revision}...\n`);
	for (let index = 0; index < REQUIRED_MODEL_FILES.length; index++) {
		const file = REQUIRED_MODEL_FILES[index];
		if (existsSync(join(modelPath, file))) continue;
		await downloadFile(modelPath, repoId, revision, file, index + 1, REQUIRED_MODEL_FILES.length);
	}

	process.stderr.write(`Model ready at ${modelPath}\n`);
	return modelPath;
}
