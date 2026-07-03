import {
  TreeSchema,
  type AnswerType,
  type Branch,
  type Node as TreeNode,
  type Tree,
  type VariableSpec,
} from '../../types/tree'
import { induceWorkup, type SkeletonNode } from './induce'
import type { DecidedCase, GenCandidateVariable, GenRosterEntry } from './types'

/**
 * Blume generator — Layer 3a: assemble the induced skeleton into a valid,
 * engine-ready Tree (plus the VariableSpecs the intake conversation needs).
 * Deterministic; the result is Zod-validated before it leaves this module.
 */

export interface AssembledDraft {
  tree: Tree
  /** Question/extraction specs for every variable the tree asks about. */
  variableSpecs: VariableSpec[]
  /** nodeId → supporting case ids (thin-evidence detection reads this). */
  leafSupport: Record<string, string[]>
  /** Workup ambiguities per specialist node (over-ordering gap input). */
  workupAmbiguities: {
    nodeId: string
    specialistName: string
    test: string
    orderedCaseIds: string[]
    notOrderedCaseIds: string[]
  }[]
}

function labelFor(key: string, candidates?: GenCandidateVariable[]): string {
  const c = candidates?.find((v) => v.key === key)
  if (c?.label) return c.label
  return key.replace(/_/g, ' ')
}

function humanValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return String(v).replace(/_/g, ' ')
}

export function assembleTree(
  skeleton: SkeletonNode,
  opts: {
    treeId?: string
    subspecialty: string
    roster: GenRosterEntry[]
    candidateVariables?: GenCandidateVariable[]
  },
): AssembledDraft {
  const nodes: TreeNode[] = []
  const leafSupport: Record<string, string[]> = {}
  const workupAmbiguities: AssembledDraft['workupAmbiguities'] = []
  const variableKeys = new Set<string>()
  const valueSamples = new Map<string, Set<unknown>>()
  let counter = 0
  const nextId = (prefix: string) => `gen_${prefix}_${++counter}`

  function emit(node: SkeletonNode): string {
    if (node.kind === 'leaf') {
      const id = nextId('specialist')
      const roster = opts.roster.find(
        (r) => r.name.trim().toLowerCase() === node.specialistName.trim().toLowerCase(),
      )
      const wu = induceWorkup(node.support)
      for (const amb of wu.ambiguities) {
        workupAmbiguities.push({
          nodeId: id,
          specialistName: node.specialistName,
          test: amb.test,
          orderedCaseIds: amb.orderedCaseIds,
          notOrderedCaseIds: amb.notOrderedCaseIds,
        })
      }
      leafSupport[id] = node.support.map((c) => c.case.id)
      nodes.push({
        id,
        type: 'specialist',
        specialistName: node.specialistName,
        specialty: roster?.specialty || opts.subspecialty,
        urgency: node.urgency,
        reasoningTemplate: `Routing to {specialistName} — the intake pattern matches ${node.support.length} case decision(s) recorded during elicitation.`,
        workup: {
          always: wu.always,
          conditional: wu.conditional,
          doNotOrderUnless: wu.doNotOrderUnless,
        },
      })
      return id
    }

    if (node.kind === 'escalate') {
      const id = nextId('escalation')
      leafSupport[id] = node.support.map((c) => c.case.id)
      nodes.push({ id, type: 'escalation', reason: node.reason })
      return id
    }

    // split
    const id = nextId(node.variableKey)
    variableKeys.add(node.variableKey)
    const label = labelFor(node.variableKey, opts.candidateVariables)
    const branches: Branch[] = node.branches.map((b) => {
      const childId = emit(b.child)
      if (b.range) {
        const parts: string[] = []
        if (b.range.min !== undefined) parts.push(`≥ ${b.range.min}`)
        if (b.range.max !== undefined) parts.push(`≤ ${b.range.max}`)
        return {
          label: `${label} ${parts.join(' and ')}`,
          condition: { op: 'range' as const, ...b.range },
          nextNodeId: childId,
        }
      }
      const raw = b.value
      if (!valueSamples.has(node.variableKey)) valueSamples.set(node.variableKey, new Set())
      valueSamples.get(node.variableKey)!.add(raw)
      const value =
        typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
          ? raw
          : String(raw)
      return {
        label: humanValue(raw),
        patientLabel: humanValue(raw),
        condition: { op: 'equals' as const, value },
        nextNodeId: childId,
      }
    })

    nodes.push({
      id,
      type: 'variable',
      variableKey: node.variableKey,
      prompt: `What best describes the patient's ${label}?`,
      dataSource: 'patient',
      branches,
    })
    return id
  }

  const rootId = emit(skeleton)

  const tree = TreeSchema.parse({
    treeId: opts.treeId ?? `gen-${opts.subspecialty.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    rootNodeId: rootId,
    nodes,
  })

  const variableSpecs: VariableSpec[] = [...variableKeys].map((key) => {
    const samples = [...(valueSamples.get(key) ?? [])]
    const label = labelFor(key, opts.candidateVariables)
    let answerType: AnswerType = 'text'
    if (samples.length > 0 && samples.every((s) => typeof s === 'boolean')) answerType = 'boolean'
    else if (samples.length > 0 && samples.every((s) => typeof s === 'number')) answerType = 'number'
    else if (samples.length > 0) answerType = 'single_choice'
    return {
      key,
      clinicalPrompt: `Establish the patient's ${label}.`,
      patientQuestion: `What best describes your ${label}?`,
      answerType,
      options: answerType === 'single_choice' ? samples.map((s) => String(s)) : undefined,
      extractionHints: `Values seen during elicitation: ${samples.map((s) => String(s)).join(', ') || 'free text'}.`,
    }
  })

  return { tree, variableSpecs, leafSupport, workupAmbiguities }
}

/** Convenience: skeleton in, draft out — used by the wizard and by tests. */
export function assembleFromDecisions(
  skeleton: SkeletonNode,
  decided: DecidedCase[],
  opts: Parameters<typeof assembleTree>[1],
): AssembledDraft {
  void decided // (reserved for future path-dependent assembly refinements)
  return assembleTree(skeleton, opts)
}
