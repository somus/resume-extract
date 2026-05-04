export interface EntityRuleConfig {
	min_length?: number;
	exceptions?: string[];
	blocked_words?: string[];
	aliases?: Record<string, string>;
	require?: string;
	reject_patterns?: string[];
	strip_prefixes?: string[];
	gazetteer_bypass?: boolean;
	uppercase_bypass?: boolean;
	strip_trailing_state_code?: boolean;
}

export interface PostProcessingConfig {
	span_merge_max_gap: number;
	span_merge_labels: string[];
	company_gazetteer_match_max_words: number;
	title_company_separators: string[];
	max_experience_months: number;
	present_words: string[];
	date_words: string[];
	space_collapse_pairs: [string, string][];
	entity_rules: Record<string, EntityRuleConfig>;
}

export interface PreProcessingConfig {
	normalize_dashes?: boolean;
	normalize_bullets?: boolean;
	collapse_multi_spaces?: boolean;
	strip_labels?: string[];
	bullet_chars?: string[];
	bullet_replacement?: string;
	dash_replacements?: Record<string, string>;
	expand_skill_tables?: boolean;
	skill_table_categories?: string[];
	table_prose_max_words?: number;
	table_continuation_max_chars?: number;
}

export interface ResumeConfig {
	seniority_keywords: Record<string, string[]>;
	seniority_by_years: Record<string, number>;
	seniority_by_experience_count: Record<string, number>;
	phone_country_prefixes: Record<string, string>;
	us_states: string[];
	city_country_map?: Record<string, string>;
	city_country_map_file?: string;
	country_name_aliases: Record<string, string>;
	multi_word_skills?: string[];
	pre_processing?: PreProcessingConfig;
	post_processing: PostProcessingConfig;
}

export interface ProcessingContext {
	config: ResumeConfig;
	companies: Set<string>;
}

export interface Personal {
	name: string | null;
	email: string | null;
	phone: string | null;
	location: string | null;
}

export interface Experience {
	title?: string;
	company?: string;
	start_date?: string;
	end_date?: string;
}

export interface Education {
	degree?: string;
	field?: string;
	institution?: string;
}

export interface ParsedResume {
	personal: Personal;
	experience: Experience[];
	education: Education[];
	skills: string[];
	certifications: string[];
	seniority: string;
	country: string | null;
	experience_years: number | null;
	_rawText: string;
}

export interface ATSIssue {
	severity: "high" | "medium" | "low";
	message: string;
}

export interface ATSCategoryDetail {
	score: number;
	max: number;
	[key: string]: unknown;
}

export interface ATSResult {
	score: number;
	details: Record<string, ATSCategoryDetail>;
	issues: ATSIssue[];
}

export type ResumeDocumentInput = Uint8Array | string;

export interface PdfOCROptions {
	backend?: "tesseract" | "easyocr" | "paddleocr";
	language?: string;
	dpi?: number;
}

export interface PdfTextExtractionOptions {
	ocr?: boolean | PdfOCROptions;
}

export interface Span {
	label: string;
	text: string;
	start: number;
	end: number;
	bio: string;
	score: number;
}

export interface NERToken {
	entity_group?: string;
	entity?: string;
	word?: string;
	start?: number;
	end?: number;
	score?: number;
}

export interface GroupedEntries {
	personal: Personal;
	experiences: Experience[];
	education: Education[];
	skills: string[];
	certifications: string[];
}
