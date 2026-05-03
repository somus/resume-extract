import { resolve } from "node:path";
import { computeATSScore, parseResume } from "./index";

const MODEL = process.env.MODEL_PATH || resolve(import.meta.dir, "../../resume-ner");

const resumes = {
	indian_swe: `Rajesh Kumar
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

Skills: Java, Spring Boot, Kafka, Python, React, AWS, Docker, Kubernetes`,

	us_swe: `John Smith
john.smith@gmail.com | (555) 123-4567 | San Francisco, CA

Senior Software Engineer
Google
January 2020 - Present
Led migration of 50 microservices to Kubernetes. Reduced deployment time by 70%.

Software Engineer
Amazon
June 2017 - December 2019
Built recommendation engine serving 100M+ users.

BS Computer Science from Stanford University, 2015

Skills: Python, Go, Kubernetes, AWS, Apache Kafka, React, Node.js, PostgreSQL, Docker`,

	nurse: `Sarah Williams, FNP-C
sarah.williams@healthnet.com | (404) 555-7788 | Atlanta, GA

Family Nurse Practitioner
Emory Healthcare
January 2019 - Present
Manage panel of 800+ patients in primary care.

Registered Nurse, Emergency Department
Grady Memorial Hospital
June 2014 - December 2018
Triaged 30+ patients per shift in Level I trauma center.

MSN from Emory University, 2018
BSN from Georgia State University, 2014

Skills: Primary Care, Diagnostics, EHR Systems, Patient Education, Chronic Disease Management`,
};

console.log("Testing @role-radar/resume-extract (Bun + TypeScript)\n");

for (const [name, text] of Object.entries(resumes)) {
	const start = performance.now();
	const result = await parseResume(text, MODEL);
	const ms = (performance.now() - start).toFixed(0);
	const ats = computeATSScore(result);

	console.log(`=== ${name} (${ms}ms) | ATS: ${ats.score}/100 ===`);
	console.log(`  Name: ${result.personal.name} | Email: ${result.personal.email}`);
	console.log(`  Phone: ${result.personal.phone} | Location: ${result.personal.location}`);
	for (const [i, exp] of result.experience.entries()) {
		console.log(`  Exp ${i}: ${JSON.stringify(exp)}`);
	}
	for (const edu of result.education) {
		console.log(`  Edu: ${JSON.stringify(edu)}`);
	}
	console.log(`  Skills (${result.skills.length}): ${result.skills.join(", ")}`);
	console.log(`  Seniority: ${result.seniority} | Country: ${result.country} | Years: ${result.experience_years}`);
	console.log(`  Issues: ${ats.issues.map((i) => `[${i.severity}] ${i.message}`).join("; ") || "none"}`);
	console.log();
}
