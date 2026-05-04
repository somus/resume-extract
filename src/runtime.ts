import type { TokenClassificationPipeline } from "@huggingface/transformers";
import { loadCompanies, loadResumeConfig } from "./config";
import type { ResumeConfig } from "./types";

interface RuntimeResources {
	pipeline: TokenClassificationPipeline;
	config: ResumeConfig;
	companies: Set<string>;
}

let cachedPipeline: TokenClassificationPipeline | null = null;
let cachedConfig: ResumeConfig | null = null;
let cachedCompanies: Set<string> | null = null;
let cachedModelPath: string | null = null;

async function loadPipeline(modelPath: string): Promise<TokenClassificationPipeline> {
	if (cachedPipeline) return cachedPipeline;
	const { pipeline } = await import("@huggingface/transformers");
	const options: Record<string, unknown> = { dtype: "q8", local_files_only: true };
	cachedPipeline = (await pipeline("token-classification", modelPath, options)) as TokenClassificationPipeline;
	return cachedPipeline;
}

export async function loadRuntime(modelPath: string): Promise<RuntimeResources> {
	if (cachedModelPath !== modelPath) {
		cachedModelPath = modelPath;
		cachedPipeline = null;
		cachedConfig = null;
		cachedCompanies = null;
	}

	if (!cachedConfig) cachedConfig = loadResumeConfig(modelPath);
	if (!cachedCompanies) cachedCompanies = loadCompanies(modelPath);

	return {
		pipeline: await loadPipeline(modelPath),
		config: cachedConfig,
		companies: cachedCompanies,
	};
}

export function resetRuntimeStateForTests() {
	cachedPipeline = null;
	cachedConfig = null;
	cachedCompanies = null;
	cachedModelPath = null;
}
