/** SQLite row types: one interface per table, matching the schema in db.ts. */

/** Row of the `materials` table. */
export interface MaterialsRow {
  id: string
  title: string
  format: string
  origin: string
  bytes: number
  hash: string
  created_at: string
  content: string
  purpose: string
}

/** Row of the `works` table. */
export interface WorkRow {
  work_id: string
  title: string
  form: string
  tags: string | null
  schema_version: number
  created_at: string
  updated_at: string
  trashed_at: string | null
  missing_at: string | null
}

/** Row of the `proposals` table. */
export interface ProposalRow {
  id: string
  title: string
  form: string
  premise: string
  characters: string | null
  conflict: string | null
  notes: string | null
  created_at: string
  used_at: string | null
  used_work_id: string | null
}

/** Row of the `session_current` table. */
export interface SessionCurrentRow {
  session_id: string
  work_id: string | null
  updated_at: string
}

/** Row of the `artifacts` table. */
export interface ArtifactsRow {
  artifact_id: string
  revision_id: string
  kind: string
  scope_chapter: number | null
  content_type: string
  content: string
  input_revision: string | null
  provenance: string
  created_at: string
}

/** Row of the `meta` table. */
export interface MetaRow {
  id: number
  work_id: string
  title: string
  form: string
  tags: string | null
  plan_approval: string
  max_chapter_tokens: number | null
  word_min: number | null
  word_max: number | null
  outline_written_at: string | null
  outline_approved_at: string | null
  outline_approved_revision: string | null
  outline_approved_source: string | null
  outline_approved_reason: string | null
  foundation_approved_at: string | null
  foundation_approved_revision: string | null
  foundation_approved_source: string | null
  foundation_approved_reason: string | null
  created_at: string
  updated_at: string
}

/** Row of the `chapters` table. */
export interface ChaptersRow {
  number: number
  title: string
  status: string
  stage: string
  current_revision: number
  words: number
  plan_approved_at: string | null
  plan_revision: string | null
  plan_approved_source: string | null
  plan_approved_reason: string | null
  provenance: string
  last_revise_mode: string | null
  state_ready_revision: number
  updated_at: string
}

/** Row of the `chapter_versions` table. */
export interface ChapterVersionsRow {
  number: number
  revision: number
  body: string
  words: number
  created_at: string
}

/** Row of the `events` table. */
export interface EventsRow {
  seq: number
  at: string
  chapter: number
  kind: string
  payload: string
}

/** Row of the `volumes` table. */
export interface VolumesRow {
  id: string
  title: string
  from_ch: number
  to_ch: number
  summary: string | null
}

/** Row of the `bible` table. */
export interface BibleRow {
  name: string
  content: string
  version: string
  updated_at: string
}

/** Row of the `search_docs` table. */
export interface SearchDocsRow {
  doc_id: string
  kind: string
  source: string
  chapter: number | null
  body: string
  tokens: string
}

/** Row of the `model_calls` table. */
export interface ModelCallsRow {
  id: number
  chapter: number | null
  role: string
  scope: string
  attempt: number
  submission_attempts: number | null
  trigger: string
  delegation_id: string | null
  child_session: string | null
  started_at: string
  ended_at: string
  duration_ms: number
  stop_reason: string | null
  outcome: string
  prompt_chars: number
  output_chars: number
  model_calls: number | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  usage_source: string
  model: string | null
  provider: string | null
  error_code: string | null
}
