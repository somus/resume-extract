import { describe, expect, test } from "bun:test";
import { computeATSScore } from "./ats";
import type { ParsedResume } from "./types";

describe("computeATSScore", () => {
	test("scores a complete resume strongly", () => {
		const parsed: ParsedResume = {
			personal: {
				name: "Jane Doe",
				email: "jane@example.com",
				phone: "+1 555 123 4567",
				location: "Seattle, WA",
			},
			experience: [
				{ title: "Senior Engineer", company: "Acme", start_date: "January 2020", end_date: "Present" },
				{ title: "Engineer", company: "Globex", start_date: "June 2017", end_date: "December 2019" },
				{ title: "Developer", company: "Initech", start_date: "January 2015", end_date: "May 2017" },
			],
			education: [{ degree: "B.Tech", field: "Computer Science", institution: "IIT Madras" }],
			skills: ["Node.js", "TypeScript", "AWS", "React", "Docker", "Kubernetes", "Postgres", "Kafka"],
			certifications: ["aws certified developer"],
			seniority: "Senior",
			country: "United States",
			experience_years: 9,
			_rawText: "Increased performance by 40% and led team of 12 engineers.",
		};

		const result = computeATSScore(parsed);

		expect(result.score).toBeGreaterThan(80);
		expect(result.issues.some((issue) => issue.severity === "high")).toBe(false);
		expect(result.details.achievements.score).toBe(5);
	});

	test("reports missing sections and weak content", () => {
		const parsed: ParsedResume = {
			personal: {
				name: null,
				email: null,
				phone: null,
				location: null,
			},
			experience: [{ title: undefined, company: undefined, start_date: undefined, end_date: undefined }],
			education: [],
			skills: [],
			certifications: [],
			seniority: "Junior",
			country: null,
			experience_years: null,
			_rawText: "Built internal tools.",
		};

		const result = computeATSScore(parsed);

		expect(result.score).toBeLessThan(40);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ severity: "high", message: expect.stringContaining("Name is missing") }),
				expect.objectContaining({ severity: "high", message: expect.stringContaining("Email address is missing") }),
				expect.objectContaining({ severity: "medium", message: expect.stringContaining("Phone number is missing") }),
				expect.objectContaining({ severity: "medium", message: expect.stringContaining("Location is missing") }),
				expect.objectContaining({ severity: "high", message: expect.stringContaining("Employment dates are missing") }),
				expect.objectContaining({ severity: "high", message: expect.stringContaining("Job titles are missing") }),
				expect.objectContaining({ severity: "high", message: expect.stringContaining("Company names are missing") }),
				expect.objectContaining({
					severity: "medium",
					message: expect.stringContaining("No education section detected"),
				}),
				expect.objectContaining({ severity: "high", message: expect.stringContaining("No skills detected") }),
				expect.objectContaining({ severity: "low", message: expect.stringContaining("No certifications listed") }),
				expect.objectContaining({
					severity: "medium",
					message: expect.stringContaining("No quantified achievements"),
				}),
			]),
		);
	});
});
