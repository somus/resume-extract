import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultModelPath, inspectModelFiles, isModelReady } from "./model-bootstrap";

describe("model bootstrap helpers", () => {
	test("returns a stable default model cache path", () => {
		expect(getDefaultModelPath()).toContain("resume-extract");
		expect(getDefaultModelPath()).toContain("resume-ner");
	});

	test("detects whether required model files exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "resume-extract-model-ready-"));
		try {
			expect(isModelReady(dir)).toBe(false);

			writeFileSync(join(dir, "config.json"), "{}");
			writeFileSync(join(dir, "tokenizer.json"), "{}");
			writeFileSync(join(dir, "tokenizer_config.json"), "{}");
			writeFileSync(join(dir, "special_tokens_map.json"), "{}");
			writeFileSync(join(dir, "vocab.txt"), "");
			writeFileSync(join(dir, "resume_config.json"), "{}");
			writeFileSync(join(dir, "companies.json"), "{}");
			writeFileSync(join(dir, "city_country_map.json"), "{}");
			mkdirSync(join(dir, "onnx"), { recursive: true });
			writeFileSync(join(dir, "onnx/config.json"), "{}");
			writeFileSync(join(dir, "onnx/model_quantized.onnx"), "");
			writeFileSync(join(dir, "onnx/ort_config.json"), "{}");
			writeFileSync(join(dir, "onnx/special_tokens_map.json"), "{}");
			writeFileSync(join(dir, "onnx/tokenizer.json"), "{}");
			writeFileSync(join(dir, "onnx/tokenizer_config.json"), "{}");
			writeFileSync(join(dir, "onnx/vocab.txt"), "");

			expect(isModelReady(dir)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("inspects missing, empty, and invalid model files", () => {
		const dir = mkdtempSync(join(tmpdir(), "resume-extract-model-inspect-"));
		try {
			mkdirSync(join(dir, "onnx"), { recursive: true });
			writeFileSync(join(dir, "config.json"), "{}");
			writeFileSync(join(dir, "tokenizer.json"), "{");
			writeFileSync(join(dir, "tokenizer_config.json"), "{}");
			writeFileSync(join(dir, "special_tokens_map.json"), "{}");
			writeFileSync(join(dir, "vocab.txt"), "");
			writeFileSync(join(dir, "resume_config.json"), "{}");
			writeFileSync(join(dir, "companies.json"), "{}");
			writeFileSync(join(dir, "city_country_map.json"), "{}");
			writeFileSync(join(dir, "onnx/config.json"), "{}");
			writeFileSync(join(dir, "onnx/model_quantized.onnx"), "");
			writeFileSync(join(dir, "onnx/ort_config.json"), "{}");
			writeFileSync(join(dir, "onnx/special_tokens_map.json"), "{}");
			writeFileSync(join(dir, "onnx/tokenizer.json"), "{}");
			// Leave onnx/tokenizer_config.json and onnx/vocab.txt missing

			const inspection = inspectModelFiles(dir);

			expect(inspection.missingFiles).toEqual(["onnx/tokenizer_config.json", "onnx/vocab.txt"]);
			expect(inspection.zeroByteFiles).toEqual(["vocab.txt", "onnx/model_quantized.onnx"]);
			expect(inspection.invalidJsonFiles).toEqual(["tokenizer.json"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
