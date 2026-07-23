import type { Condition, Node as TreeNode, SpecialistNode, Tree, VariableNode } from '../../types/tree'
import type { BranchAnchor, NodeAnchor } from './schema'

/**
 * Blume — delta anchor resolution.
 *
 * Pure functions that locate a semantically-anchored node/branch in the
 * CURRENT base tree. Every resolution returns an explicit verdict — exactly
 * one match ('resolved'), none ('unresolved'), several ('ambiguous'), or a
 * match whose content moved since authoring ('conflict'). The compiler maps
 * these onto DeltaResult statuses; nothing is ever guessed.
 */

/* -------------------------------------------------------------------------- */
/* Normalization & fingerprints                                               */
/* -------------------------------------------------------------------------- */

const DOC_PREFIX_RE = /^doc_[0-9a-f]+_(?:s\d+_)?/

/** Strip the per-upload `doc_<hex>_s<n>_` namespace so keys and ids compare
 *  across regenerations of the same CPG. */
export function normalizeKey(key: string): string {
  return key.replace(DOC_PREFIX_RE, '').trim().toLowerCase()
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** FNV-1a 32-bit, hex. Anchoring needs determinism and collision-resistance
 *  across a few hundred nodes — not cryptographic strength — and this runs
 *  synchronously in both browser and Node. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Hash of a node's verbatim CPG text — the strongest terminal anchor. */
export function clinicalBasisHash(clinicalBasis: string): string {
  return fnv1a(normalizeText(clinicalBasis))
}

/** Canonical, whitespace-free serialization of a condition. Value strings
 *  are case-normalized; `in` values are sorted (order is not semantic). */
export function conditionFingerprint(condition: Condition): string {
  switch (condition.op) {
    case 'equals':
      return `equals:${typeof condition.value}:${String(condition.value).toLowerCase()}`
    case 'range':
      return `range:${condition.min ?? ''}..${condition.max ?? ''}`
    case 'in':
      return `in:${[...condition.values].map((v) => v.toLowerCase()).sort().join('|')}`
  }
}

/** The document a node belongs to, from its id namespace ('' if unprefixed). */
export function docIdOf(nodeId: string): string {
  const m = /^doc_([0-9a-f]+)_/.exec(nodeId)
  return m ? m[1] : ''
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

export type ResolutionStatus = 'resolved' | 'unresolved' | 'ambiguous' | 'conflict'

export interface NodeResolution {
  status: ResolutionStatus
  nodeId?: string
  reason?: string
}

export interface BranchResolution {
  status: ResolutionStatus
  nodeId?: string
  branchIndex?: number
  reason?: string
}

export interface ResolveContext {
  /** documentName → docId, from the base's stored metadata. Lets `docScope`
   *  anchors filter to one grafted CPG. Optional — without it scopes are
   *  ignored (single-document trees). */
  docs?: Record<string, string>
  /** Hash of the current base — pinned anchors stale on mismatch. */
  baseHash?: string
}

function inScope(node: TreeNode, docScope: string | undefined, ctx: ResolveContext): boolean {
  if (!docScope || !ctx.docs) return true
  const docId = ctx.docs[docScope]
  if (!docId) return true // unknown scope name — don't silently exclude everything
  return docIdOf(node.id) === docId
}

export function resolveNodeAnchor(tree: Tree, anchor: NodeAnchor, ctx: ResolveContext = {}): NodeResolution {
  if (anchor.kind === 'pinned') {
    if (anchor.baseHash && ctx.baseHash && anchor.baseHash !== ctx.baseHash) {
      return { status: 'unresolved', reason: 'pinned to a previous base — the base has been regenerated' }
    }
    const node = tree.nodes.find((n) => n.id === anchor.nodeId)
    return node
      ? { status: 'resolved', nodeId: node.id }
      : { status: 'unresolved', reason: `pinned node "${anchor.nodeId}" no longer exists` }
  }

  if (anchor.kind === 'variable') {
    const want = normalizeKey(anchor.variableKey)
    const matches = tree.nodes.filter(
      (n): n is VariableNode =>
        n.type === 'variable' && normalizeKey(n.variableKey) === want && inScope(n, anchor.docScope, ctx),
    )
    if (matches.length === 1) return { status: 'resolved', nodeId: matches[0].id }
    if (matches.length === 0) return { status: 'unresolved', reason: `no variable with key "${anchor.variableKey}"` }
    return {
      status: 'ambiguous',
      reason: `variable key "${anchor.variableKey}" matches ${matches.length} nodes${anchor.docScope ? '' : ' — add a docScope'}`,
    }
  }

  // Terminal anchor: clinicalBasisHash → specialistName → specialty.
  const terminals = tree.nodes.filter(
    (n): n is SpecialistNode => n.type === 'specialist' && inScope(n, anchor.docScope, ctx),
  )

  if (anchor.clinicalBasisHash) {
    const byBasis = terminals.filter(
      (n) => n.clinicalBasis && clinicalBasisHash(n.clinicalBasis) === anchor.clinicalBasisHash,
    )
    if (byBasis.length === 1) return { status: 'resolved', nodeId: byBasis[0].id }
    if (byBasis.length > 1)
      return { status: 'ambiguous', reason: `clinical basis matches ${byBasis.length} terminals` }
    // No basis match — fall through to name, but a name hit then means the
    // CPG text behind this terminal changed: conflict, not a quiet re-match.
    if (anchor.specialistName) {
      const byName = terminals.filter(
        (n) => normalizeText(n.specialistName) === normalizeText(anchor.specialistName!),
      )
      if (byName.length === 1)
        return {
          status: 'conflict',
          nodeId: byName[0].id,
          reason: 'terminal found by name, but the CPG text behind it changed since this delta was authored',
        }
    }
    return { status: 'unresolved', reason: 'no terminal matches the recorded CPG text' }
  }

  if (anchor.specialistName) {
    const want = normalizeText(anchor.specialistName)
    const byName = terminals.filter((n) => normalizeText(n.specialistName) === want)
    if (byName.length === 1) return { status: 'resolved', nodeId: byName[0].id }
    if (byName.length > 1) {
      const bySpecialty = anchor.specialty
        ? byName.filter((n) => normalizeText(n.specialty) === normalizeText(anchor.specialty!))
        : []
      if (bySpecialty.length === 1) return { status: 'resolved', nodeId: bySpecialty[0].id }
      return { status: 'ambiguous', reason: `terminal name "${anchor.specialistName}" matches ${byName.length} nodes` }
    }
    return { status: 'unresolved', reason: `no terminal named "${anchor.specialistName}"` }
  }

  if (anchor.specialty) {
    const want = normalizeText(anchor.specialty)
    const bySpecialty = terminals.filter((n) => normalizeText(n.specialty) === want)
    if (bySpecialty.length === 1) return { status: 'resolved', nodeId: bySpecialty[0].id }
    if (bySpecialty.length > 1)
      return { status: 'ambiguous', reason: `specialty "${anchor.specialty}" matches ${bySpecialty.length} terminals` }
  }
  return { status: 'unresolved', reason: 'terminal anchor has nothing to match on' }
}

export function resolveBranchAnchor(tree: Tree, anchor: BranchAnchor, ctx: ResolveContext = {}): BranchResolution {
  const nodeRes = resolveNodeAnchor(tree, anchor.node, ctx)
  if (nodeRes.status !== 'resolved') return { status: nodeRes.status, reason: nodeRes.reason }

  const node = tree.nodes.find((n) => n.id === nodeRes.nodeId)
  if (!node || node.type !== 'variable')
    return { status: 'unresolved', reason: 'branch anchor resolved to a non-variable node' }

  const byFingerprint = node.branches
    .map((b, i) => ({ fp: conditionFingerprint(b.condition), i }))
    .filter((x) => x.fp === anchor.conditionFingerprint)
  if (byFingerprint.length === 1) return { status: 'resolved', nodeId: node.id, branchIndex: byFingerprint[0].i }
  if (byFingerprint.length > 1)
    return { status: 'ambiguous', nodeId: node.id, reason: 'condition matches several branches on this node' }

  // Fingerprint miss: try the authored label. A label hit with a different
  // condition means the guideline changed this branch → conflict.
  if (anchor.label) {
    const want = normalizeText(anchor.label)
    const byLabel = node.branches.map((b, i) => ({ label: normalizeText(b.label), i })).filter((x) => x.label === want)
    if (byLabel.length === 1)
      return {
        status: 'conflict',
        nodeId: node.id,
        branchIndex: byLabel[0].i,
        reason: 'branch found by label, but its condition changed since this delta was authored',
      }
    if (byLabel.length > 1)
      return { status: 'ambiguous', nodeId: node.id, reason: `label "${anchor.label}" matches several branches` }
  }
  return { status: 'unresolved', nodeId: node.id, reason: 'no branch matches the recorded condition or label' }
}

/* -------------------------------------------------------------------------- */
/* Anchor construction (authoring side)                                       */
/* -------------------------------------------------------------------------- */

/** Build the strongest available anchor for a node in the current base.
 *  The UI calls this when a delta is authored. */
export function anchorForNode(node: TreeNode, opts: { docScope?: string; baseHash?: string } = {}): NodeAnchor {
  if (node.type === 'variable') {
    return { kind: 'variable', variableKey: normalizeKey(node.variableKey), ...(opts.docScope ? { docScope: opts.docScope } : {}) }
  }
  if (node.type === 'specialist') {
    return {
      kind: 'terminal',
      ...(node.clinicalBasis ? { clinicalBasisHash: clinicalBasisHash(node.clinicalBasis) } : {}),
      specialistName: node.specialistName,
      ...(node.specialty ? { specialty: node.specialty } : {}),
      ...(opts.docScope ? { docScope: opts.docScope } : {}),
    }
  }
  // Escalations have no semantic identity — pin them.
  return { kind: 'pinned', nodeId: node.id, baseHash: opts.baseHash ?? '' }
}

/** Build a branch anchor for the branch at `index` on a variable node. */
export function anchorForBranch(
  node: VariableNode,
  index: number,
  opts: { docScope?: string; baseHash?: string } = {},
): BranchAnchor {
  const branch = node.branches[index]
  return {
    node: anchorForNode(node, opts),
    conditionFingerprint: conditionFingerprint(branch.condition),
    label: branch.label,
  }
}

/** Deterministic hash of a whole base tree (id-insensitive where possible is
 *  NOT attempted — this is a change detector, not an anchor). */
export function baseTreeHash(tree: Tree): string {
  return fnv1a(JSON.stringify(tree))
}
