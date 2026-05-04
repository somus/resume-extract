import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { computeATSScore, parseResume } from "./index";

const MODEL = process.env.MODEL_PATH || resolve(import.meta.dir, "../../resume-ner");

describe("parseResume", () => {
	test("parses clean structured resume text", async () => {
		const text = `Rajesh Kumar
rajesh.kumar@gmail.com | +91 98765 43210 | Bangalore, India

Senior Software Engineer
Infosys
April 2020 - Present

Software Engineer
TCS
June 2016 - March 2020

Wipro
Software Developer
July 2014 - May 2016

B.Tech in Computer Science from IIT Madras, 2014

Skills: Java, Spring Boot, Kafka, Python, React, AWS, Docker, Kubernetes`;

		const result = await parseResume(text, MODEL);
		const ats = computeATSScore(result);

		expect(result.personal.name).toBe("Rajesh Kumar");
		expect(result.personal.email).toBe("rajesh.kumar@gmail.com");
		expect(result.country).toBe("India");
		expect(result.seniority).toBe("Senior");
		expect(result.skills).toContain("Spring Boot");
		expect(result.experience.length).toBeGreaterThanOrEqual(3);
		expect(ats.score).toBeGreaterThan(80);
	});
});
