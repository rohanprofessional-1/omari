import { createTreeFull, type TreeSummary } from '../api'
import {
  createGenSession,
  patchGenSession,
  generateCPGScaffold,
  type CPGBaseMeta,
  type GenRosterEntry,
} from '../genApi'
import type { Tree } from '../../types/tree'

/**
 * Blume — Sprout's document-to-tree generator.
 *
 * The old Generate wizard's `start()` flow, lifted out of the page and into a
 * function Sprout can call from inside the Builder. Same backend contract, same
 * delta-layer base: create a session, extract each CPG file into a scaffold,
 * save the unified draft to the library. Nothing loads onto the canvas here —
 * the caller (BuilderChatPanel) reviews the result and only the clinician's
 * confirm opens it. Generation is a PROPOSAL, exactly like every other Sprout
 * edit: the assistant transcribes the guideline, it never signs it off.
 */

export interface GenerateFromDocsInput {
  /** CPG files to extract (PDF / TXT / EPUB). At least one. */
  files: File[]
  /** The subspecialty the tree is for — drives section extraction. */
  subspecialty: string
  /** Optional authoring surgeon name, recorded on the session. */
  surgeonName?: string
  /** Optional specialist roster; placeholder endpoints are used when empty. */
  roster?: GenRosterEntry[]
}

/**
 * The three backend calls the pipeline makes, injected so the orchestration
 * (validation, sequencing, naming) is testable without a live server. Defaults
 * to the real API client; tests pass stubs.
 */
export interface GenerateFromDocsDeps {
  createGenSession: typeof createGenSession
  generateCPGScaffold: typeof generateCPGScaffold
  createTreeFull: typeof createTreeFull
  patchGenSession: typeof patchGenSession
}

const REAL_DEPS: GenerateFromDocsDeps = {
  createGenSession,
  generateCPGScaffold,
  createTreeFull,
  patchGenSession,
}

export interface GenerateFromDocsResult {
  /** The saved library tree — open it in the Builder by id. */
  summary: TreeSummary
  /** The generated draft tree (already persisted as the summary above). */
  tree: Tree
  /** How many specialist endpoints came back as "[Assign specialist — …]". */
  placeholderCount: number
  /** Structural issues the scaffold reported (dead ends, orphans, …). */
  validationIssues: unknown[]
  /** The files that produced it, for the confirmation summary. */
  fileNames: string[]
}

/** Progress phases surfaced to the chat so the wait reads as work, not a hang. */
export type GenProgress =
  | { phase: 'session' }
  | { phase: 'extract'; fileName: string; index: number; total: number }
  | { phase: 'save' }

/**
 * Run the full ingest → extract → save pipeline. Resolves with the saved
 * library tree; the caller decides when (and whether) to load it. Throws on
 * any failure — the caller shows the message and nothing is left half-applied
 * on the canvas because the canvas is never touched here.
 */
export async function generateTreeFromDocuments(
  input: GenerateFromDocsInput,
  onProgress?: (p: GenProgress) => void,
  deps: GenerateFromDocsDeps = REAL_DEPS,
): Promise<GenerateFromDocsResult> {
  const subspecialty = input.subspecialty.trim()
  if (!subspecialty) throw new Error('Name the subspecialty before generating.')
  if (input.files.length === 0) throw new Error('Attach at least one guideline document to generate from.')

  const roster = (input.roster ?? []).filter((r) => r.name.trim())

  onProgress?.({ phase: 'session' })
  const session = await deps.createGenSession({
    subspecialty,
    surgeonName: input.surgeonName?.trim() || undefined,
    roster,
  })

  let latestTree: Tree | null = null
  let placeholderCount = 0
  let validationIssues: unknown[] = []
  const baseMetas: CPGBaseMeta[] = []

  // Sequential — each scaffold merges onto the session's growing draft.
  for (let i = 0; i < input.files.length; i++) {
    const file = input.files[i]
    onProgress?.({ phase: 'extract', fileName: file.name, index: i, total: input.files.length })
    const result = await deps.generateCPGScaffold(session.id, file)
    latestTree = result.tree
    placeholderCount = result.placeholderCount
    validationIssues = result.validationIssues
    if (result.baseMeta) baseMetas.push(result.baseMeta)
  }

  if (!latestTree) throw new Error('The documents produced no tree — check the files and try again.')

  onProgress?.({ phase: 'save' })
  const fileNames = input.files.map((f) => f.name)
  const treeName =
    input.files.length === 1
      ? `${fileNames[0].replace(/\.[^/.]+$/, '')} (CPG draft)`
      : `${subspecialty} (CPG draft)`

  const summary = await deps.createTreeFull(treeName, latestTree, {
    description: `Generated from ${fileNames.join(', ')} in session ${session.id}`,
    // Delta layer: the raw scaffold is the BASE that clinic deltas replay onto.
    baseTree: latestTree,
    baseMeta: baseMetas.length === 1 ? baseMetas[0] : baseMetas.length > 1 ? { docs: baseMetas } : undefined,
  })

  await deps.patchGenSession(session.id, { treeId: summary.id, stage: 'done', status: 'completed' })

  return { summary, tree: latestTree, placeholderCount, validationIssues, fileNames }
}
