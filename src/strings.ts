import type { ResumeConfig } from "./types";

export function cleanSpaces(config: ResumeConfig, text: string): string {
	let result = text;
	for (const [oldValue, newValue] of config.post_processing.space_collapse_pairs) {
		result = result.replaceAll(oldValue, newValue);
	}
	return result.replace(/,\s*$/g, "").trim();
}

export function cleanPhone(phone: string): string {
	return phone
		.replace(/\(\s+/g, "(")
		.replace(/\s+\)/g, ")")
		.replace(/\s+-\s+/g, "-")
		.replace(/\+\s+/g, "+")
		.replace(/\s+/g, " ")
		.trim();
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
