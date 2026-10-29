/**
 * SQLite row shapes for the catalog and one work database.
 *
 * These interfaces mirror `src/db.ts` (WORK_SCHEMA_VERSION 8). They describe
 * storage rows only: JSON columns stay strings, and parsing belongs to the
 * artifact/consumer layer.
 */

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

export interface SessionCurrentRow {
  session_id: string
  work_id: string | null
  updated_at: string
}

export interface MetaRow {
  id: 1
  work_id: string
  title: string
  form: string
  tags: string | null
  plan_approval: 'required' | 'off'
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

export interface ChapterRow {
  number: number
  title: string
  status: string
  stage: string
  current_revision: number
  words: number
  plan_approved_at: string | null
  plan_revision: string | null
  plan_approved_source: string | null
  state_ready_revision: number
  plan_approved_reason: string | null
  provenance: 'generated' | 'imported' | 'edited'
  last_revise_mode: string | null
  updated_at: string
}

export interface ChapterVersionRow {
  number: number
  revision: number
  body: string
  words: number
  created_at: string
}

export interface EventRow {
  seq: number
  at: string
  chapter: number
  kind: string
  payload: string
}

export interface VolumeRow {
  id: string
  title: string
  from_ch: number
  to_ch: number
  summary: string | null
}

export interface BibleRow {
  name: string
  content: string
  version: string
  updated_at: string
}

export interface ArtifactRow {
  artifact_id: string
  revision_id: string
  kind: string
  scope_chapter: number | null
  content_type: 'json' | 'text'
  content: string
  provenance: 'generated' | 'imported' | 'edited'
  created_at: string
  input_revision?: string | null
}

export interface MaterialRow {
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

export interface SearchDocRow {
  doc_id: string
  kind: string
  source: string
  chapter: number | null
  body: string
  tokens: string
}
