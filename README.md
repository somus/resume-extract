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

Latest model metrics (noise-augmented, 25 epochs, entity-level exact-match via seqeval):

- entity F1: 97.62%
- structured micro F1: 98.16%
- long resume micro F1: 91.7% (resumes >512 tokens, section-aware chunked inference)
- noisy resume F1: 72.67% (OCR/scraped text)
- quantized ONNX size: 63MB

Entity types:

- NAME, EMAIL, PHONE, LOCATION, COMPANY, TITLE, DATE, DEGREE, INSTITUTION, FIELD, SKILL, CERT, LANGUAGE

Model directory should include:

- `resume_config.json` — pre-processing, post-processing, and inference rules
- `companies.json` — company gazetteer for post-processing
- `city_country_map.json` — 317 cities for country inference
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

## CLI

Run directly with Bun:

```bash
 bun run cli ./resume.pdf --ats
 bun run cli --text "Jane Doe..."
 bun run cli ./resume.pdf --view json --output result.json
cat ./resume.txt | bun run cli

# Batch mode
bun run cli batch ./resumes/*.pdf --ats
bun run cli batch --input-dir ./resumes --glob '**/*' --output batch.jsonl
bun run cli batch --input-dir ./resumes --output batch.csv --output-format csv
bun run cli batch --input-dir ./resumes --fail-fast

# Explicit model setup and diagnostics
bun run cli setup-model
bun run cli doctor --ocr
bun run cli doctor --fix
bun run cli doctor --json
```

Common flags:

- `--model <path>`: model directory
- `--model-repo <repo>`: alternate Hugging Face repo for first-run download
- `--model-revision <rev>`: alternate model revision for first-run download
- `--no-download`: disable automatic model download
- `--input <path>`: input file path
- `--text <text>`: inline text input
- `--format <auto|text|pdf|docx>`: override format detection
- `--ocr`: enable PDF OCR (defaults to Tesseract)
- `--ocr-backend <backend>`: OCR backend: `tesseract`, `easyocr`, or `paddleocr`
- `--ats`: include ATS scoring in output
- `--view <json|pretty>`: render machine JSON or human-friendly terminal output
- `--output <path>`: write structured output to a file
- `--compact`: emit minified JSON

Batch-only flags:

- `batch [inputs...]`: process many resumes at once
- `--input-dir <path>`: scan a directory for resumes
- `--glob <pattern>`: file selection pattern for directory scanning
- `--concurrency <n>`: parallel batch workers, defaults to `4`
- `--fail-fast`: stop batch processing on the first extraction error
- `--output-format <json|jsonl|csv>`: structured batch output format

Extra commands:

- `setup-model`: download the configured model into the local cache or custom `--model` path
- `doctor`: inspect model readiness, file integrity, writable cache paths, runtime platform, and optional OCR availability
- `doctor --fix`: download/repair the configured model, then report status
- `doctor --json`: emit machine-readable diagnostics

Build a single Bun binary:

```bash
bun run build:bin
./dist/resume-extract --input ./resume.pdf --ats
```

Install the latest released binary:

```bash
curl -fsSL https://raw.githubusercontent.com/somus/resume-extract/main/scripts/install-release.sh | bash
resume-extract --help
```

The installer downloads the latest GitHub Release asset into `~/.local/bin`. Override `INSTALL_DIR`, `REPO`, or `VERSION` if needed:

```bash
INSTALL_DIR=/usr/local/bin VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/somus/resume-extract/main/scripts/install-release.sh | bash
```

On first run, the CLI automatically downloads the required `oksomu/resume-ner` model files into a local cache if they are missing and shows download progress. Pass `--model` to use a custom directory or `--no-download` to require a pre-populated model directory.

Output behavior:

- Single resume commands default to `pretty` view on a TTY and `json` otherwise.
- Batch commands default to `pretty` summaries on a TTY and structured JSON otherwise.
- Use `--view json` when piping to other tools.
- Use `--output` with `batch` plus `--output-format jsonl` for machine-friendly bulk processing.
- Use `--output-format csv` when you want spreadsheet-friendly flat output with summary fields plus numbered experience and education columns.

## Setup

```bash
bun install
```

Notes:

- `parseResume()` is text-only fast path.
- `parseResumePdf()` and `parseResumeDocx()` use `@kreuzberg/node` for local document text extraction.
- `parseResumePdf(..., { ocr: true })` enables OCR for scanned PDFs (defaults to Tesseract). Supports `tesseract`, `easyocr`, and `paddleocr` backends via `{ ocr: { backend: "easyocr" } }`. OCR is much slower than text parsing.
- The CLI downloads models automatically by default; library consumers should still manage model directories explicitly.

## Limitations

- English resumes only
- Max 512 tokens per chunk (section-aware chunking handles longer resumes)
- Image-based/scanned PDFs require OCR before text extraction
- Two-column PDF layouts may flatten during text extraction

## Development

```bash
bun run test        # Run tests
bun run check       # Biome lint + format check
bun run typecheck   # TypeScript type check
bun run format      # Auto-format
```

## License

MIT
