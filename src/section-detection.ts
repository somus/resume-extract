import type { Span } from "./types";

const BULLET_PATTERN = /^[-●•▪■▸►‣⁃]\s*/;

interface Section {
	name: string;
	start: number;
	end: number;
	text: string;
}

const SECTION_PATTERNS: Record<string, string[]> = {
	skills: [
		"skills",
		"technical skills",
		"core competencies",
		"competencies",
		"areas of expertise",
		"areas of excellence",
		"proficiencies",
		"technical proficiencies",
		"key skills",
		"professional skills",
		"summary of qualifications",
		"qualifications",
		"tools & technologies",
		"tools and technologies",
		"technologies",
		"tech stack",
		"devops tools & technologies",
		"devops tools",
	],
	certifications: [
		"certifications",
		"licenses & certifications",
		"licenses",
		"professional certifications",
		"credentials",
		"certifications & licenses",
		"awards & certifications",
	],
	languages: ["languages", "language skills", "linguistic skills"],
};

function detectSections(text: string): Section[] {
	const lines = text.split("\n");
	const linePositions: number[] = [];
	let charPos = 0;
	for (const line of lines) {
		linePositions.push(charPos);
		charPos += line.length + 1;
	}

	const headerLines: Array<{ lineIdx: number; name: string }> = [];
	for (let i = 0; i < lines.length; i++) {
		let stripped = lines[i].trim().replace(/:$/, "").toLowerCase();
		stripped = stripped.replace(/[^a-z\s&]/g, "").trim();
		if (!stripped || stripped.length > 60) continue;

		for (const [sectionName, patterns] of Object.entries(SECTION_PATTERNS)) {
			if (patterns.includes(stripped)) {
				headerLines.push({ lineIdx: i, name: sectionName });
				break;
			}
		}
	}

	const sections: Section[] = [];
	for (let idx = 0; idx < headerLines.length; idx++) {
		const { lineIdx, name } = headerLines[idx];
		const start = linePositions[lineIdx];
		const end = idx + 1 < headerLines.length ? linePositions[headerLines[idx + 1].lineIdx] : text.length;
		sections.push({ name, start, end, text: text.slice(start, end) });
	}

	return sections;
}

function extractListItems(text: string): string[] {
	const items: string[] = [];
	for (let line of text.split("\n")) {
		line = line.trim().replace(BULLET_PATTERN, "");
		if (!line || line.length > 120) continue;

		const colonMatch = line.match(/^[A-Za-z\s&/()-]+:\s*(.+)$/);
		if (colonMatch) line = colonMatch[1];

		const parts = line.split(/\s*[,|]\s*|\s+-\s+/);
		for (const part of parts) {
			const cleaned = part.trim().replace(/[.,;:]+$/, "");
			if (cleaned.length > 2 && cleaned.length < 50) {
				items.push(cleaned);
			}
		}
	}
	return items;
}

function isTagged(start: number, end: number, spans: Span[]): boolean {
	for (const span of spans) {
		if (span.start < end && span.end > start) return true;
	}
	return false;
}

export function fillMissingEntities(text: string, spans: Span[]): Span[] {
	const sections = detectSections(text);
	const added: Span[] = [];

	for (const section of sections) {
		if (section.name === "skills") {
			const headerEnd = section.text.indexOf("\n");
			const bodyText = headerEnd === -1 ? "" : section.text.slice(headerEnd + 1);
			const bodyOffset = headerEnd === -1 ? 0 : headerEnd + 1;
			const items = extractListItems(bodyText);
			for (const item of items) {
				const localIdx = bodyText.indexOf(item);
				if (localIdx === -1) continue;
				const idx = section.start + bodyOffset + localIdx;
				if (!isTagged(idx, idx + item.length, spans)) {
					added.push({ label: "SKILL", text: item, start: idx, end: idx + item.length, bio: "B", score: 0.8 });
				}
			}
		} else if (section.name === "certifications") {
			for (let line of section.text.split("\n")) {
				line = line.trim().replace(BULLET_PATTERN, "");
				if (!line || line.length < 5 || line.length > 100) continue;
				const stripped = line
					.toLowerCase()
					.replace(/[^a-z\s&]/g, "")
					.trim();
				if (SECTION_PATTERNS.certifications.includes(stripped)) continue;
				const localIdx = section.text.indexOf(line);
				if (localIdx === -1) continue;
				const idx = section.start + localIdx;
				if (!isTagged(idx, idx + line.length, spans)) {
					added.push({ label: "CERT", text: line, start: idx, end: idx + line.length, bio: "B", score: 0.8 });
				}
			}
		} else if (section.name === "languages") {
			for (let line of section.text.split("\n")) {
				line = line.trim().replace(BULLET_PATTERN, "");
				if (!line || line.length < 3 || line.length > 60) continue;
				const stripped = line
					.toLowerCase()
					.replace(/[^a-z\s]/g, "")
					.trim();
				if (["languages", "language skills", "linguistic skills"].includes(stripped)) continue;
				const langMatch = line.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
				if (langMatch) {
					const lang = langMatch[1];
					const localIdx = section.text.indexOf(lang);
					if (localIdx === -1) continue;
					const idx = section.start + localIdx;
					if (!isTagged(idx, idx + lang.length, spans)) {
						added.push({ label: "LANGUAGE", text: lang, start: idx, end: idx + lang.length, bio: "B", score: 0.8 });
					}
				}
			}
		}
	}

	return [...spans, ...added].sort((a, b) => a.start - b.start);
}
