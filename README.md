# resume-extract

Fast, local resume extraction using a fine-tuned DistilBERT NER model. Extracts structured data from resume text, PDF, or DOCX via local document parsing + ONNX inference.

## Features

- **Structured extraction**: name, email, phone, location, companies, titles, education, skills
- **Document input support**: parse raw text, PDF, or DOCX
- **ATS scoring**: completeness score with actionable issues list
- **Seniority inference**: from job titles + years of experience
- **Country detection**: from location + phone prefix
- **Experience years**: computed from employment dates
- **100% local**: runs offline via ONNX, no API calls
- **Fast text parsing**: ~15ms per resume after model load
- **Optional document parsing**: PDF via Kreuzberg, including OCR when enabled; DOCX via Kreuzberg

## Model

Uses [`oksomu/resume-ner`](https://huggingface.co/oksomu/resume-ner) — a DistilBERT model fine-tuned for resume NER and exported to ONNX for local structured extraction.

Latest published model metrics:

- entity F1: 97.27%
- entity precision: 96.76%
- entity recall: 97.78%
- internal structured micro F1: 97.58%
- internal structured macro F1: 98.12%
- clean-resume structured micro F1: 99.44%
- noisy-resume structured micro F1: 60.91%
- quantized ONNX size: 63MB

Entity types:

- NAME, EMAIL, PHONE, LOCATION, COMPANY, TITLE, DATE, DEGREE, INSTITUTION, FIELD, SKILL, CERT, LANGUAGE

Model directory should include:

- `resume_config.json`
- `companies.json`
- tokenizer/config files
- `onnx/model_quantized.onnx` or `onnx/model.onnx`

## Usage

```typescript
import {
  computeATSScore,
  parseResume,
  parseResumeDocx,
  parseResumePdf,
} from "resume-extract";

const result = await parseResume(resumeText, "/path/to/model");
const fromPdf = await parseResumePdf("/path/to/resume.pdf", "/path/to/model");
const fromScannedPdf = await parseResumePdf(pdfBytes, "/path/to/model", { ocr: true });
const fromDocx = await parseResumeDocx("/path/to/resume.docx", "/path/to/model");

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

Notes:

- `parseResume()` is text-only fast path.
- `parseResumePdf()` and `parseResumeDocx()` use `@kreuzberg/node` for local document text extraction.
- `parseResumePdf(..., { ocr: true })` enables Tesseract OCR for scanned PDFs. OCR is much slower than text parsing and may require Tesseract runtime on host machine.

## Development

```bash
bun run test        # Run tests
bun run check       # Biome lint + format check
bun run typecheck   # TypeScript type check
bun run format      # Auto-format
```

## License

MIT
