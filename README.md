# resume-extract

Fast, local resume extraction using a fine-tuned DistilBERT NER model. Extracts structured data from resume text in ~15ms via ONNX inference.

## Features

- **Structured extraction**: name, email, phone, location, companies, titles, education, skills
- **ATS scoring**: completeness score with actionable issues list
- **Seniority inference**: from job titles + years of experience
- **Country detection**: from location + phone prefix
- **Experience years**: computed from employment dates
- **100% local**: runs offline via ONNX, no API calls
- **Fast**: ~15ms per resume after model load

## Model

Uses [`oksomu/resume-ner`](https://huggingface.co/oksomu/resume-ner) — a DistilBERT model fine-tuned on 4300+ resumes across 14 industries.

- F1: 98.1% | Precision: 99.1% | Recall: 97.0%
- 13 entity types: NAME, EMAIL, PHONE, LOCATION, COMPANY, TITLE, DATE, DEGREE, INSTITUTION, FIELD, SKILL, CERT, LANGUAGE
- 63MB quantized ONNX

## Usage

```typescript
import { parseResume, computeATSScore } from "resume-extract";

const result = await parseResume(resumeText, "/path/to/model");

// result.personal: { name, email, phone, location }
// result.experience: [{ title, company, start_date, end_date }]
// result.education: [{ degree, field, institution }]
// result.skills: ["Python", "AWS", ...]
// result.seniority: "Senior"
// result.country: "India"
// result.experience_years: 10

const ats = computeATSScore(result);
// ats.score: 87
// ats.issues: [{ severity: "medium", message: "..." }]
```

## Setup

```bash
bun install

# Download model from HuggingFace
hf download oksomu/resume-ner --local-dir ./model
```

## Development

```bash
bun run test        # Run tests
bun run check       # Biome lint + format check
bun run typecheck   # TypeScript type check
bun run format      # Auto-format
```

## License

MIT
