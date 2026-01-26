# Personal Family Superapp — PRD (Markdown)

**Owner:** Max  
**Status:** Draft v0.2 (updated per comments)  
**Frontend:** React + shadcn/ui (Vercel)  
**Backend:** Supabase (Auth + Postgres + Storage + Edge Functions; local via Supabase CLI)  
**LLM Gateway:** OpenRouter (server-side only)  
**Clients:** Latest Chrome (desktop + mobile web) + PWA (Android/iOS)

---

## 1) Vision

A single secure web/PWA “home base” for your family’s personal life, composed of mini-apps with consistent navigation and modern UI.  
**First mini-app:** Health — focused on storing medical/vet documents and chatting with an LLM grounded in those documents.

---

## 2) Scope & Constraints

### In scope (overall app)
- Works on **PC + mobile** via latest Chrome.
- **PWA** install mode for Android/iOS.
- **Google login** (Supabase Auth).
- **Bilingual UI:** Russian + English.
- **Light/Dark theme**, modern UI (shadcn/ui).
- **Language + theme stored locally** on device.
- **Security appropriate for sensitive personal data.**
- **Local-first dev:** full stack runnable locally (Supabase local DB/Storage/Functions).

### Out of scope (for MVP)
- Complex permissions model (fine-grained privacy/sharing).
- Admin UI for invites/roles (admin management can be manual DB edits).
- Caregiver/care roles.
- Metrics / success KPIs (personal use case).
- Automated email notifications.
- Export to PDF/CSV.

---

## 3) Users & Data Ownership Model (Simplified)

### Users (accounts)
- Each user logs in with Google.
- **Access control is allowlist-based:** only users present in the database can access the app.

### Family “space”
- MVP assumes **a single family space** (one household).
- **All data is shared by default** among allowed users.
- Post-MVP can add privacy toggles (personal vs shared) if you decide you need it.

### Persons (including pets)
Health features operate on a **Person** entity:
- Person can be a **human** or a **pet** (e.g., your dog).
- Admin manages persons (create/update) via **manual DB edits** in MVP.

**Key decision:** `Person != Account`.  
A Person can exist without having their own login (dependents, pets). Accounts are just app users.

---

## 4) Mini-app Architecture & Navigation

### App shell (global)
- Top navigation:
  - Mini-app switcher (Health now; others later)
  - Current Person selector (humans + pets)
  - Settings (theme/lang)
  - Profile/logout

### Mini-app pattern
- Each mini-app has:
  - Sidebar on desktop / bottom nav on mobile
  - Consistent header, page layouts, and empty/loading/error states
- No command palette in MVP.

---

## 5) Tech Requirements & Architecture

### 5.1 Frontend
- **React** (recommended: **Next.js** for routing + server actions/API routes on Vercel).
- **shadcn/ui** for component library.
- State:
  - **TanStack Query** for server state (Supabase reads/writes, caching).
  - **Zustand** for UI state (theme/lang, selected person, dialogs).
- i18n:
  - `next-intl` (or similar) with RU/EN dictionaries.
- Local settings:
  - `localStorage` keys:
    - `app.lang = "ru" | "en"`
    - `app.theme = "light" | "dark"` (optionally `system` later)

### 5.2 Backend (Supabase)
- **Auth:** Google OAuth
- **Postgres:** app data
- **Storage:** medical record originals (photos/PDFs)
- **Edge Functions:** server-side logic, especially LLM calls
- Local environment:
  - Supabase CLI (`supabase start`) runs Auth/DB/Storage/Functions locally.

### 5.3 LLM via OpenRouter (Security Requirement)
- **OpenRouter API key must never be shipped to client.**
- All LLM calls go through **Supabase Edge Function** (or Vercel server route), which:
  - Validates user session
  - Enforces access checks (allowlist + household)
  - Fetches relevant data for RAG
  - Calls OpenRouter
  - Stores chat history + citations

### 5.4 Testing (MVP)
- Local manual testing + unit tests where helpful.
- No Playwright requirement for MVP.

---

## 6) Security Requirements (MVP)

### 6.1 Access Control (simple but strong)
- Allowlist table (e.g., `allowed_users`):
  - `email` or `auth_user_id`
- On login, backend checks membership in allowlist:
  - If not allowed → deny access (show “Access not granted” screen).

### 6.2 Database security
- **Row Level Security (RLS)** enabled on all tables.
- Policies for MVP (single household, shared-by-default):
  - Allowed users can read/write within the household.
  - Non-allowed users can read nothing.

### 6.3 Storage security
- Supabase Storage buckets are **private**.
- Client receives **signed URLs** to read attachments (short TTL).
- Upload uses authenticated session; store paths under household/person folders.

### 6.4 Secrets & keys
- OpenRouter key stored in server env (Supabase function env vars and/or Vercel env).
- Never stored in client.

---

## 7) Health Mini-app — MVP Scope

### MVP includes only:
1) **Medical Records Database**
2) **Health Chat (LLM) grounded in records** (one thread per Person)

Everything else (plans, checkups, medication reminders) is **post-MVP**.

---

# 8) Health: Medical Records Database — Detailed PRD

## 8.1 Core UX Flows

### Flow A — Browse & search records
1. Select Person (human/pet).
2. See list of records with:
   - record type, title, date
   - tags (optional)
   - attachment count
3. Search box filters by:
   - title, notes
   - extracted/OCR text
4. Filter chips:
   - type (Lab, Visit, Imaging, Prescription, Vaccination, Vet, Other)
   - date range
   - “Removed” toggle

### Flow B — Add record (manual upload) with preview/edit before final save
1. “Add record” → choose photo/PDF.
2. App uploads the file(s) and runs extraction (OCR/text + LLM suggestions).
3. **Preview & edit (draft):** user reviews the original preview and edits fields before final save:
   - record type, date, title
   - notes, tags/keywords (optional)
   - attachment actions (optional MVP): reorder, rotate (crop later)
4. **Final save:** record becomes visible in the main list and searchable.
5. If user cancels, the draft is discarded (record + attachments removed) or kept as draft (implementation choice; default: discard).

### Flow C — Remove record (soft delete)
- “Remove” marks record as removed (not hard-deleted).
- Removed records are hidden by default but discoverable via filter.

---

## 8.2 Data Model (Proposed)

### Tables (MVP)

#### `allowed_users`
- `auth_user_id` (uuid) or `email` (text, unique)
- `added_at`

#### `persons`
- `id` (uuid)
- `name`
- `kind` (`human` | `pet`)
- `species` (nullable, e.g., "dog")
- `birthday` (nullable)
- `notes` (nullable)

#### `medical_records`
- `id` (uuid)
- `person_id` (fk persons)
- `created_by_user_id`
- `record_type` (enum)
- `record_date` (date, nullable)
- `title` (text)
- `notes` (text, nullable)
- `status` (`draft` | `active` | `removed`)
- `removed_at` (nullable)
- `created_at`, `updated_at`
- `ocr_text` (text, nullable)
- `llm_summary` (text, nullable)
- `llm_keywords` (text[], nullable)

#### `record_attachments`
- `id`
- `record_id`
- `storage_path`
- `mime_type`
- `original_filename`
- `created_at`

#### `record_chunks` (for RAG; generated)
- `id`
- `record_id`
- `chunk_index`
- `content` (text)
- `embedding` (vector nullable; post-MVP can make it required)
- `created_at`

> Note: You can start with chunks **without embeddings** and rely on full-text search. Embeddings can be added later without breaking the model.

#### `health_chat_threads`
- `id`
- `person_id`
- `created_at`

#### `health_chat_messages`
- `id`
- `thread_id`
- `role` (`user` | `assistant` | `system`)
- `content` (text)
- `created_at`
- `sources` (jsonb nullable; list of referenced `record_id`/`chunk_id`)

---

## 8.3 Full-Text Search (MVP Retrieval)
Enable Postgres full-text indexing on:
- `medical_records.title`
- `medical_records.notes`
- `medical_records.ocr_text`
- `record_chunks.content`

Query strategy:
- Given (person_id, search_string), retrieve top N chunks/records using:
  - Postgres `tsvector` + `tsquery` ranking
  - Optional metadata boosts (recent records higher, certain types higher)

This supports both:
- User search in UI
- RAG retrieval for chat

---

## 8.4 Document Ingestion Pipeline (Photo/PDF → Record)

### Goals
- “Photo and go”: user uploads once; system extracts useful text + metadata suggestions.
- Preserve originals for legal/medical fidelity.

### Step-by-step (MVP)
1. **Select files (photo/PDF) in UI**
   - User chooses one or multiple files.

2. **Upload as draft**
   - Client uploads originals to Supabase Storage.
   - Create a **draft** `medical_records` row + `record_attachments` rows.
   - Drafts are not shown in the main list until confirmed.

3. **Extraction (triggered immediately)**
   - **Recommended for MVP:** client calls `ingest_record` Edge Function right after upload.

4. **OCR (text extraction)**
   - Images: **client-side OCR** using `tesseract.js` (keeps raw pixels on device) → client sends extracted text to backend.
   - PDFs:
     - If PDF has embedded text → extract on server in Edge Function using a PDF text extractor.
     - If PDF is scanned image PDF → treat pages as images (post-MVP if hard).

   **Optional fallback (accuracy mode):**
   - If OCR text is empty/garbage, server can call a **multimodal model via OpenRouter** to read the image.
   - This trades privacy for accuracy; keep it OFF by default and enable only when you choose.

5. **LLM structuring & metadata suggestions**
   - Edge Function calls OpenRouter with OCR text (and optionally images if fallback):
     - classify record type
     - propose title and date
     - generate short summary
     - produce keywords/tags

6. **Preview & edit (draft review screen)**
   - UI shows:
     - original preview (image/PDF pages)
     - extracted text + summary
     - editable fields: type/date/title/notes/tags
     - simple attachment actions (optional MVP): reorder, rotate
   - User chooses:
     - **Confirm & Save** → finalize record
     - **Cancel** → discard draft

7. **Finalize record**
   - Set `medical_records.status = active`.
   - Chunk the final text into `record_chunks`.

8. **(Optional) Embeddings (post-MVP)**
   - Store vectors in `record_chunks.embedding` for semantic retrieval.

### Outputs written back to DB
- `medical_records.ocr_text`
- `medical_records.llm_summary`
- `medical_records.llm_keywords`
- `record_chunks[]`

---

# 9) Health: LLM Chat (RAG) — Detailed PRD

## 9.1 Chat Scope (MVP)
- One **thread per Person**.
- No shared/family-wide thread.

## 9.2 Chat UX
- Person selector at top.
- Chat page:
  - message list
  - composer with attachments disabled (MVP)
  - assistant responses include **Sources** section:
    - list of cited records
    - each source links to record detail

## 9.3 RAG Pipeline (MVP)

### Request handling (server-side function `health_chat`)
Input:
- `person_id`
- `user_message`

Steps:
1. **Auth & access check**
   - Verify Supabase session.
   - Verify user is in allowlist.

2. **Retrieve context**
   - Use full-text search over `record_chunks` for the `person_id`.
   - Select top K chunks (e.g., 6–12) with:
     - chunk text
     - record metadata (date, type, title)
   - Build a context pack:
     - `[{record_id, title, date, type, chunk_id, chunk_text}, ...]`

3. **Prompt assembly**
   - System instructions:
     - Use only provided context when referencing user-specific facts.
     - If info is missing, say so and ask for missing doc types (in UI you can show “Add record” CTA).
     - Provide cautious medical tone; highlight red flags when needed.
   - User message appended.
   - Context appended as numbered citations:
     - e.g. `[S1] ...chunk...`

4. **OpenRouter call**
   - Model selection (MVP): pick a strong general chat model.
   - Temperature low-moderate for consistency.

5. **Response post-processing**
   - Extract citations used (e.g., S1, S3) from model output.
   - Convert to record links in UI.
   - Store message + sources in `health_chat_messages.sources`.

Output:
- Assistant message + list of sources.

## 9.4 Retrieval Quality (MVP → Post-MVP evolution)

### MVP retrieval (FTS only)
Pros:
- Simple, local-friendly, no extra models
Cons:
- Worse for paraphrases and messy OCR

### Post-MVP upgrade: hybrid retrieval
- Add embeddings per chunk:
  - `embedding = embed(chunk_text)` via OpenRouter embeddings model
- Retrieve:
  - semantic top K + full-text top K
- Merge + rerank (simple scoring or small reranker model)

---

# 10) MVP Delivery Plan (Step-by-step Stages)

## Stage 0 — Repo & Local Stack Skeleton
- Next.js + shadcn/ui setup
- Supabase local environment runnable
- Basic layout: app shell + mini-app switcher stub
- Local theme/lang settings

**Exit criteria:** App loads locally, theme/lang toggles persist locally.

## Stage 1 — Auth + Allowlist Gate
- Google login via Supabase
- `allowed_users` table + RLS
- Gate screen for non-allowed users

**Exit criteria:** Only allowlisted users can access app pages.

## Stage 2 — Persons (Humans + Pets) via DB
- `persons` table + RLS
- Person selector UI (read-only; CRUD can be manual DB edits)
- Health mini-app entry point per Person

**Exit criteria:** Switching person changes context across Health.

## Stage 3 — Medical Records CRUD + Storage (Draft-first)
- `medical_records`, `record_attachments`
- Upload attachments (image/PDF) into **draft records**
- Preview page for a record (show originals)
- List, detail, search (FTS), soft delete

**Exit criteria:** You can create draft records, view originals, and manage records for humans and pets.

## Stage 4 — Extraction + Preview/Edit + Finalize
- Client-side OCR for images (tesseract.js)
- Edge Function `ingest_record`:
  - LLM classification + summary + keywords
  - extraction text stored on draft
- Draft review UI:
  - preview originals + extracted text
  - edit type/date/title/notes/tags
  - confirm → status becomes `active`
- chunking into `record_chunks`

**Exit criteria:** Uploading a photo produces a draft with extracted info, and after review it becomes an active searchable record.

## Stage 5 — Health Chat (RAG)
- `health_chat_threads` (auto-create per person)
- `health_chat_messages`
- Edge Function `health_chat`:
  - retrieve top chunks
  - OpenRouter response with sources
- UI: chat page with sources links

**Exit criteria:** Asking questions returns grounded answers with clickable sources.

---

# 11) Post-MVP Backlog (Health + Platform)

### Health (post-MVP)
- Health plans & reminders dashboard (from your PDF concept)
- Medication reminders (push notifications only)
- Structured lab values + trends
- Better OCR + scanned PDF handling
- Hybrid retrieval with embeddings
- Privacy controls per person/record (if you decide you need it)

### Platform (post-MVP)
- Admin UI (invites, roles, household management)
- Multiple households (optional)
- Backup/export
- More mini-apps

---

## 12) Explicit Decisions (Locked for this PRD)
- Permissions: **keep simple** in MVP (shared-by-default; allowlist access).
- Admin management: **manual DB edits** in MVP; no invitations UI.
- Care role: not in MVP.
- Persons include **pets**.
- Health MVP: **only medical records + chat**.
- No command palette.
- No Playwright requirement.
- Chat: **one thread per person only**.
- No additional rate limiting in app (LLM provider handles).
- Notifications: **push only** (post-MVP).
- No export requirements.

