import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

	const remoteSha = await fetchRemoteSha(repoId, revision);
	if (remoteSha) {
		writeFileSync(join(modelPath, ".commit-sha"), remoteSha);
		writeUpdateCheckState(modelPath, { lastCheck: Date.now(), localSha: remoteSha, remoteSha });
	}

	process.stderr.write(`Model ready at ${modelPath}\n`);
	return modelPath;
}

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_FILE = ".update-check.json";

interface UpdateCheckState {
	lastCheck: number;
	localSha: string | null;
	remoteSha: string | null;
}

function getUpdateCheckPath(modelPath: string): string {
	return join(modelPath, UPDATE_CHECK_FILE);
}

function readUpdateCheckState(modelPath: string): UpdateCheckState | null {
	const path = getUpdateCheckPath(modelPath);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

function writeUpdateCheckState(modelPath: string, state: UpdateCheckState): void {
	const path = getUpdateCheckPath(modelPath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state));
}

async function fetchRemoteSha(repoId: string, revision: string): Promise<string | null> {
	try {
		const response = await fetch(`https://huggingface.co/api/models/${repoId}/revision/${revision}`, {
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { sha?: string };
		return data.sha ?? null;
	} catch {
		return null;
	}
}

function getLocalSha(modelPath: string): string | null {
	const refsPath = join(modelPath, ".commit-sha");
	if (existsSync(refsPath)) {
		return readFileSync(refsPath, "utf-8").trim();
	}
	return null;
}

export interface UpdateCheckResult {
	updateAvailable: boolean;
	localSha: string | null;
	remoteSha: string | null;
}

export async function checkForModelUpdate(
	modelPath: string,
	repoId = DEFAULT_MODEL_REPO,
	revision = DEFAULT_MODEL_REVISION,
): Promise<UpdateCheckResult | null> {
	const state = readUpdateCheckState(modelPath);
	const now = Date.now();

	if (state && now - state.lastCheck < UPDATE_CHECK_INTERVAL_MS) {
		if (state.remoteSha && state.localSha && state.remoteSha !== state.localSha) {
			return { updateAvailable: true, localSha: state.localSha, remoteSha: state.remoteSha };
		}
		return null;
	}

	const remoteSha = await fetchRemoteSha(repoId, revision);
	const localSha = getLocalSha(modelPath);
	const newState: UpdateCheckState = { lastCheck: now, localSha, remoteSha };
	writeUpdateCheckState(modelPath, newState);

	if (remoteSha && localSha && remoteSha !== localSha) {
		return { updateAvailable: true, localSha, remoteSha };
	}
	return null;
}

export async function updateModel(options: ModelBootstrapOptions): Promise<string> {
	const modelPath = options.modelPath;
	const repoId = options.repoId || DEFAULT_MODEL_REPO;
	const revision = options.revision || DEFAULT_MODEL_REVISION;
	mkdirSync(modelPath, { recursive: true });

	const remoteSha = await fetchRemoteSha(repoId, revision);
	const localSha = getLocalSha(modelPath);

	if (remoteSha && localSha && remoteSha === localSha) {
		process.stderr.write(`Model already up to date (${localSha.slice(0, 8)}).\n`);
		writeUpdateCheckState(modelPath, { lastCheck: Date.now(), localSha, remoteSha });
		return modelPath;
	}

	process.stderr.write(`Updating model from ${repoId}@${revision}...\n`);
	for (let index = 0; index < REQUIRED_MODEL_FILES.length; index++) {
		const file = REQUIRED_MODEL_FILES[index];
		await downloadFile(modelPath, repoId, revision, file, index + 1, REQUIRED_MODEL_FILES.length);
	}

	const inspection = inspectModelFiles(modelPath);
	if (inspection.missingFiles.length > 0 || inspection.zeroByteFiles.length > 0) {
		throw new Error(
			`Model update incomplete: missing=[${inspection.missingFiles.join(", ")}] zero-byte=[${inspection.zeroByteFiles.join(", ")}]`,
		);
	}

	const newSha = remoteSha || (await fetchRemoteSha(repoId, revision));
	if (newSha) {
		writeFileSync(join(modelPath, ".commit-sha"), newSha);
		writeUpdateCheckState(modelPath, { lastCheck: Date.now(), localSha: newSha, remoteSha: newSha });
	}

	process.stderr.write(`Model updated at ${modelPath}\n`);
	return modelPath;
}
