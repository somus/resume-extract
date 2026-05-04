import type { ATSCategoryDetail, ATSIssue, ATSResult, ParsedResume } from "./types";

export function computeATSScore(parsed: ParsedResume): ATSResult {
	let score = 0;
	const details: Record<string, ATSCategoryDetail> = {};
	const expCount = parsed.experience.length;
	const skillCount = parsed.skills.length;
	const withTitles = parsed.experience.filter((experience) => experience.title).length;
	const withCompanies = parsed.experience.filter((experience) => experience.company).length;
	const withDates = parsed.experience.filter((experience) => experience.start_date).length;

	let contact = 0;
	if (parsed.personal.name) contact += 5;
	if (parsed.personal.email) contact += 5;
	if (parsed.personal.phone) contact += 5;
	if (parsed.personal.location) contact += 5;
	details.contact = { score: contact, max: 20 };
	score += contact;

	const experienceScore =
		Math.min(expCount * 4, 12) +
		Math.min(withTitles * 2, 4) +
		Math.min(withCompanies * 2, 4) +
		Math.min(withDates * 2, 5);
	details.experience = { score: Math.min(experienceScore, 25), max: 25, roles: expCount };
	score += Math.min(experienceScore, 25);

	let educationScore = 0;
	if (parsed.education.length > 0) educationScore += 5;
	if (parsed.education.some((education) => education.degree)) educationScore += 4;
	if (parsed.education.some((education) => education.institution)) educationScore += 3;
	if (parsed.education.some((education) => education.field)) educationScore += 3;
	details.education = { score: Math.min(educationScore, 15), max: 15 };
	score += Math.min(educationScore, 15);

	let skillsScore = 0;
	if (skillCount >= 1) skillsScore += 4;
	if (skillCount >= 3) skillsScore += 4;
	if (skillCount >= 5) skillsScore += 4;
	if (skillCount >= 8) skillsScore += 4;
	if (skillCount >= 12) skillsScore += 4;
	details.skills = { score: Math.min(skillsScore, 20), max: 20, count: skillCount };
	score += Math.min(skillsScore, 20);

	let formattingScore = 0;
	if (expCount >= 2) formattingScore += 2;
	if (expCount >= 3) formattingScore += 1;
	if (parsed.experience_years && parsed.experience_years >= 2) formattingScore += 2;
	if (parsed.certifications.length > 0) formattingScore += 2;
	const datesWithMonth = parsed.experience.filter(
		(experience) => experience.start_date && /[a-zA-Z]/.test(experience.start_date),
	).length;
	if (datesWithMonth > 0) formattingScore += 2;
	if (datesWithMonth === expCount && expCount > 0) formattingScore += 1;
	if (withTitles === expCount && expCount > 0) formattingScore += 2;
	if (withCompanies === expCount && expCount > 0) formattingScore += 2;
	if (contact === 20) formattingScore += 2;
	if (skillCount >= 8) formattingScore += 2;
	details.formatting = { score: Math.min(formattingScore, 20), max: 20 };
	score += Math.min(formattingScore, 20);

	const hasQuantified =
		/\d+%|\$[\d,.]+[MBK]?|\b\d{2,}\s*(users|customers|clients|engineers|people|team|employees|members|patients|students|projects|accounts|microservices)/i.test(
			parsed._rawText,
		);
	const hasMetrics =
		/\b(increased|reduced|grew|saved|delivered|generated|managed|led|built|launched|drove|improved|achieved|exceeded|scaled|optimized|automated|streamlined)\b/i.test(
			parsed._rawText,
		);
	const achievementsScore = (hasQuantified ? 3 : 0) + (hasMetrics && hasQuantified ? 2 : 0);
	details.achievements = {
		score: Math.min(achievementsScore, 5),
		max: 5,
		hasQuantified,
		hasMetrics,
	};
	score += Math.min(achievementsScore, 5);

	const issues: ATSIssue[] = [];
	if (!parsed.personal.name)
		issues.push({ severity: "high", message: "Name is missing - add your full name at the top of your resume" });
	if (!parsed.personal.email)
		issues.push({
			severity: "high",
			message: "Email address is missing - add a professional email in the contact section",
		});
	if (!parsed.personal.phone)
		issues.push({
			severity: "medium",
			message: "Phone number is missing - include a phone number for recruiter callbacks",
		});
	if (!parsed.personal.location)
		issues.push({ severity: "medium", message: "Location is missing - add city and state/country for job matching" });
	if (expCount === 0)
		issues.push({
			severity: "high",
			message: "No work experience detected - add a clearly labeled experience section with job titles and companies",
		});
	if (expCount > 0 && withDates === 0) {
		issues.push({
			severity: "high",
			message: "Employment dates are missing - add start and end dates (e.g., January 2020 - Present) for each role",
		});
	} else if (withDates < expCount) {
		issues.push({
			severity: "medium",
			message: `${expCount - withDates} experience entries missing dates - add date ranges for all roles`,
		});
	}
	if (expCount > 0 && withTitles === 0)
		issues.push({ severity: "high", message: "Job titles are missing - add a clear title for each role" });
	if (expCount > 0 && withCompanies === 0)
		issues.push({ severity: "high", message: "Company names are missing - add employer names for each role" });
	if (parsed.education.length === 0)
		issues.push({
			severity: "medium",
			message: "No education section detected - add degree, institution, and field of study",
		});
	if (skillCount === 0) {
		issues.push({
			severity: "high",
			message:
				"No skills detected - add a dedicated skills section with 8-12 relevant technical and professional skills",
		});
	} else if (skillCount < 5) {
		issues.push({
			severity: "medium",
			message: `Only ${skillCount} skills found - aim for 8-12 relevant skills to improve keyword matching`,
		});
	}
	if (!parsed.certifications.length)
		issues.push({
			severity: "low",
			message: "No certifications listed - add relevant certifications to strengthen your profile",
		});
	if (expCount > 0 && !hasQuantified) {
		issues.push({
			severity: "medium",
			message:
				"No quantified achievements - add metrics like '40% increase in performance', 'led team of 12', '$2M revenue'",
		});
	}

	return { score: Math.min(score, 100), details, issues };
}
