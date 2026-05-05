import { describe, expect, test } from "bun:test";
import { fillMissingEntities } from "./section-detection";
import type { Span } from "./types";

function span(label: string, text: string, start: number): Span {
	return { label, text, start, end: start + text.length, bio: "B", score: 0.95 };
}

describe("fillMissingEntities", () => {
	test("extracts skills from Skills section that NER missed", () => {
		const text = "Name: John\n\nSkills\nPython, React, AWS, Docker\n\nExperience\nSoftware Engineer";
		const existingSpans = [span("NAME", "John", 6)];
		const result = fillMissingEntities(text, existingSpans);
		const skillTexts = result.filter((s) => s.label === "SKILL").map((s) => s.text);
		expect(skillTexts).toContain("Python");
		expect(skillTexts).toContain("React");
		expect(skillTexts).toContain("AWS");
		expect(skillTexts).toContain("Docker");
	});

	test("does not duplicate already-tagged entities", () => {
		const text = "Skills\nPython, React, AWS";
		const pythonIdx = text.indexOf("Python");
		const existingSpans = [span("SKILL", "Python", pythonIdx)];
		const result = fillMissingEntities(text, existingSpans);
		const pythonSpans = result.filter((s) => s.text === "Python");
		expect(pythonSpans).toHaveLength(1);
	});

	test("extracts certifications from Certifications section", () => {
		const text = "Certifications\nAWS Solutions Architect\nKubernetes Administrator";
		const result = fillMissingEntities(text, []);
		const certs = result.filter((s) => s.label === "CERT").map((s) => s.text);
		expect(certs).toContain("AWS Solutions Architect");
		expect(certs).toContain("Kubernetes Administrator");
	});

	test("extracts languages from Languages section", () => {
		const text = "Languages\nEnglish (Native)\nSpanish (Fluent)\nFrench (Basic)";
		const result = fillMissingEntities(text, []);
		const langs = result.filter((s) => s.label === "LANGUAGE").map((s) => s.text);
		expect(langs).toContain("English");
		expect(langs).toContain("Spanish");
		expect(langs).toContain("French");
	});

	test("returns spans sorted by start position", () => {
		const text = "Skills\nPython, React\n\nLanguages\nEnglish";
		const result = fillMissingEntities(text, []);
		for (let i = 1; i < result.length; i++) {
			expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].start);
		}
	});

	test("handles text with no recognized sections", () => {
		const text = "Just some random text without any section headers";
		const existingSpans = [span("NAME", "random", 10)];
		const result = fillMissingEntities(text, existingSpans);
		expect(result).toEqual(existingSpans);
	});

	test("handles Category: prefix in skills section", () => {
		const text = "Technical Skills\nLanguages: Python, JavaScript, Go\nFrameworks: React, Django";
		const result = fillMissingEntities(text, []);
		const skills = result.filter((s) => s.label === "SKILL").map((s) => s.text);
		expect(skills).toContain("Python");
		expect(skills).toContain("JavaScript");
		expect(skills).toContain("React");
		expect(skills).toContain("Django");
	});

	test("skips section header line when extracting skills", () => {
		const text = "Skills\nPython, React";
		const result = fillMissingEntities(text, []);
		const skills = result.filter((s) => s.label === "SKILL").map((s) => s.text);
		expect(skills).not.toContain("Skills");
	});

	test("does not match items outside section boundaries", () => {
		const text = "Experience\nPython developer at Acme\n\nSkills\nReact, Docker";
		const result = fillMissingEntities(text, []);
		const skills = result.filter((s) => s.label === "SKILL");
		for (const skill of skills) {
			expect(skill.start).toBeGreaterThanOrEqual(text.indexOf("Skills"));
		}
		expect(skills.map((s) => s.text)).not.toContain("Python");
	});

	test("handles duplicate section headers without duplicating entities", () => {
		const text = "Skills\nPython, React\n\nSkills\nDocker, AWS";
		const result = fillMissingEntities(text, []);
		const skills = result.filter((s) => s.label === "SKILL").map((s) => s.text);
		expect(skills).toContain("Python");
		expect(skills).toContain("React");
		expect(skills).toContain("Docker");
		expect(skills).toContain("AWS");
		const unique = new Set(skills);
		expect(unique.size).toBe(skills.length);
	});
});
