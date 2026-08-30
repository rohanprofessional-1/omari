import assert from 'node:assert'
import { buildJourney } from './journey'
import type { CarePlan } from './carePlan'
import type { AuditEvent, ReviewableReferral } from '../../dashboard/types'

declare const process: { exitCode?: number } | undefined

function referral(id: string): ReviewableReferral {
  return {
    payload: {
      referralId: id,
      receivedAt: '2026-08-01T00:00:00.000Z',
      channel: 'epic',
      patient: {
        name: 'Test Patient',
        mrn: 'MRN-1',
        dob: '1990-01-01',
        sex: 'F',
        phone: '555-0101',
      },
      referredBy: {
        provider: 'Dr. Referrer',
        npi: '12345',
        practice: 'Clinic',
        phone: '555-0000',
        fax: '555-0001',
      },
      referredToDepartment: 'Neurology',
      priority: 'routine',
      reasonForReferral: 'Nerve pain',
      clinicalNote: '',
      diagnoses: [],
      attachments: [],
      structured: {},
    },
    extraction: { variables: {}, sources: {} },
    result: {
      inScope: true,
      routedTo: { specialistName: 'Dr. Neill Li', specialty: 'Neurology', nodeId: 'n1' },
      urgency: 'routine',
      pathTaken: [],
      missingVariables: [],
      requiredWorkup: [],
      escalated: false,
      confidence: 'high',
      confidenceReason: 'ok',
      overrideNodeIds: [],
      terminalOverridden: false,
      flags: {},
    },
  } as ReviewableReferral
}

function buildPlan(): CarePlan {
  return {
    approved: true,
    consultation: { at: '2026-08-20T09:00:00.000Z', label: 'Initial consultation', bookedAt: '2026-08-11T00:00:00.000Z' },
    offers: [],
    daysToConsultation: 19,
    tests: [],
    toBook: [],
    doneCount: 0,
    bookedCount: 0,
    total: 0,
  }
}

function testApprovalAppearsInPatientJourney() {
  const ref = referral('REF-APPROVED')
  const audit: AuditEvent[] = [
    {
      id: 'evt-1',
      referralId: 'REF-APPROVED',
      at: '2026-08-10T00:00:00.000Z',
      actor: 'Dr. Neill Li',
      role: 'surgeon',
      action: 'approved',
      note: 'Approved for consultation',
    },
  ]

  const journey = buildJourney({ referral: ref, audit, plan: buildPlan(), careTeam: 'Dr. Neill Li’s team' })
  const approvalEvent = journey.find((event) => event.title.startsWith('Approved by'))
  if (!approvalEvent) {
    throw new Error('Expected patient journey to include approval event')
  }
  if (approvalEvent.detail !== 'Your consultation dates and test list were released.') {
    throw new Error(`Unexpected approval detail: ${approvalEvent.detail}`)
  }
  if (approvalEvent.state !== 'past') {
    throw new Error(`Expected approval event to be in the past, got ${approvalEvent.state}`)
  }
}

try {
  testApprovalAppearsInPatientJourney()
  console.log('[journey.test.ts] PASS')
} catch (err) {
  console.error('[journey.test.ts] FAIL:', err instanceof Error ? err.message : err)
  if (typeof process !== 'undefined') process.exitCode = 1
}
