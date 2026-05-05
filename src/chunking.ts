import type { PreTrainedTokenizer } from "@huggingface/transformers";

export interface TextChunk {
	text: string;
	offset: number;
}

const MAX_TOKENS = 512;

function splitIntoSections(text: string): string[] {
	return text.split(/\n{2,}/).filter((block) => block.trim());
}

function splitOversizedSection(text: string, offset: number, tokenizer: PreTrainedTokenizer): TextChunk[] {
	const sentences = text.split(/(?<=\.)\s+/);
	const chunks: TextChunk[] = [];
	let current: string[] = [];
	let currentOffset = offset;

	for (const sentence of sentences) {
		const candidate = current.length > 0 ? `${current.join(" ")} ${sentence}` : sentence;
		const tokens = tokenizer.encode(candidate, { add_special_tokens: false }).length;

		if (tokens > MAX_TOKENS && current.length > 0) {
			const chunkText = current.join(" ");
			chunks.push({ text: chunkText, offset: currentOffset });
			currentOffset = currentOffset + chunkText.length + 1;
			current = [sentence];
		} else {
			current.push(sentence);
		}
	}

	if (current.length > 0) {
		chunks.push({ text: current.join(" "), offset: currentOffset });
	}

	return chunks;
}

export function chunkText(text: string, tokenizer: PreTrainedTokenizer | null): TextChunk[] {
	if (!tokenizer) return [{ text, offset: 0 }];

	const tokenCount = tokenizer.encode(text, { add_special_tokens: false }).length;
	if (tokenCount <= MAX_TOKENS) {
		return [{ text, offset: 0 }];
	}

	const sections = splitIntoSections(text);
	const chunks: TextChunk[] = [];
	let currentSections: string[] = [];
	let currentOffset = 0;

	for (const section of sections) {
		const candidate = currentSections.length > 0 ? `${currentSections.join("\n\n")}\n\n${section}` : section;
		const candidateTokens = tokenizer.encode(candidate, { add_special_tokens: false }).length;

		if (candidateTokens > MAX_TOKENS && currentSections.length > 0) {
			chunks.push({ text: currentSections.join("\n\n"), offset: currentOffset });
			currentOffset = text.indexOf(section, currentOffset);
			currentSections = [section];
		} else if (candidateTokens > MAX_TOKENS && currentSections.length === 0) {
			const sectionOffset = text.indexOf(section, currentOffset);
			chunks.push(...splitOversizedSection(section, sectionOffset, tokenizer));
			currentOffset = sectionOffset + section.length;
			continue;
		} else {
			if (currentSections.length === 0) {
				currentOffset = text.indexOf(section, currentOffset);
			}
			currentSections.push(section);
		}
	}

	if (currentSections.length > 0) {
		chunks.push({ text: currentSections.join("\n\n"), offset: currentOffset });
	}

	return chunks;
}
