import type { ReviewableReferral } from '../../types'

/**
 * Dashboard — the ONE hardcoded demo referral.
 *
 * DEMO PURPOSES ONLY. This is not derived through the deterministic engine —
 * Dr. Patel is not a destination on dukeNerveTree, so this is authored by
 * hand as a fully-formed ReviewableReferral (payload + extraction + result),
 * matching the Omari intake conversation:
 *
 *   Patient: "Numbness in my left hand from a recent fall."
 *   Omari:   "Have you ever had a nerve test done for this, like an EMG or
 *             nerve conduction study?"
 *   Patient: "No, I haven't."
 *   Omari:   "How long ago did this happen?"
 *   Patient: "A few days ago."
 *   -> Routed to Dr. Patel's team (Peripheral Nerve Surgery), expedited.
 *
 * BOUND TO THE DEMO PATIENT. src/auth/demoUsers.ts pins the patient account
 * to this referral's MRN, and the surgeon account to 'Dr. Patel' -- the exact
 * string in `result.routedTo.specialistName` below. Referral scoping matches
 * on both verbatim.
 */

const RECEIVED_AT = '2026-07-24T07:45:00'
const VISIT_DATE = '2026-08-08'

export const DAN_REFERRAL: ReviewableReferral = {
  payload: {
    referralId: 'REF-2026-0200',
    receivedAt: RECEIVED_AT,
    channel: 'epic',
    patient: {
      name: 'Dan Whitfield',
      mrn: 'MRN-7823410',
      dob: '1989-04-17',
      sex: 'M',
      phone: '(919) 555-0288',
    },
    referredBy: {
      provider: 'Omari AI Care Coordinator',
      npi: 'N/A - self-referred via patient intake',
      practice: 'Duke Nerve Center Patient Portal',
      phone: '(919) 555-0100',
    },
    referredToDepartment: 'Duke Nerve Center',
    priority: 'urgent',
    reasonForReferral:
      'Numbness and tingling in the left hand following a recent fall; no prior nerve testing.',
    clinicalNote:
      'Patient completed AI-guided intake via Omari. Reports numbness and tingling in the left ' +
      'hand and difficulty gripping objects following a fall a few days ago. Confirmed no prior ' +
      'EMG or nerve conduction study for this issue. Based on the reported mechanism (recent fall) ' +
      "and absence of baseline nerve testing, the intake routed this referral to Dr. Patel's " +
      'team for expedited peripheral nerve evaluation.',
    diagnoses: [
      { icd10: 'G56.90', description: 'Mononeuropathy of unspecified upper limb' },
    ],
    attachments: [
      { title: 'Omari AI intake summary', type: 'note', date: RECEIVED_AT.slice(0, 10), pages: 1 },
    ],
    structured: {
      problems: ['Left hand numbness', 'Grip weakness, left hand'],
    },
  },
  extraction: {
    variables: {
      urgentRedFlag: { value: 'none', confidence: 0.9 },
      presentationCategory: { value: 'traumatic_chronic', confidence: 0.88 },
      symptomRegion: { value: 'hand_fingers', confidence: 0.9 },
      nerveStudyStatus: { value: 'not_done', confidence: 0.95 },
      durationBand: { value: 'acute_lt2wk', confidence: 0.92 },
    },
    sources: {
      urgentRedFlag: 'note',
      presentationCategory: 'note',
      symptomRegion: 'note',
      nerveStudyStatus: 'note',
      durationBand: 'note',
    },
  },
  result: {
    inScope: true,
    routedTo: {
      specialistName: 'Dr. Patel',
      specialty: 'Peripheral Nerve Surgery',
      nodeId: 'dan_spec_patel',
    },
    urgency: 'expedited',
    pathTaken: [
      {
        variableKey: 'presentationCategory',
        label: 'Presentation category',
        answer: 'Numbness in the hand following a recent fall',
        confidence: 0.88,
        nodeId: 'dan_node_presentation',
        source: 'note',
        citation: 'Patient described numbness and grip difficulty starting after a fall.',
        overridden: false,
      },
      {
        variableKey: 'nerveStudyStatus',
        label: 'Nerve study status',
        answer: "Hasn't had an EMG or nerve conduction study",
        confidence: 0.95,
        nodeId: 'dan_node_emg',
        source: 'note',
        citation: 'Patient confirmed no prior EMG/NCS when asked directly by Omari.',
        overridden: false,
      },
      {
        variableKey: 'durationBand',
        label: 'Duration',
        answer: 'A few days ago',
        confidence: 0.92,
        nodeId: 'dan_node_duration',
        source: 'note',
        citation: 'Patient reported the fall happened a few days ago.',
        overridden: false,
      },
    ],
    missingVariables: [],
    requiredWorkup: [
      {
        name: 'EMG / Nerve Conduction Study (left upper extremity)',
        protocol: 'Median/ulnar motor and sensory NCS with needle EMG of the left hand and forearm.',
        rationale: 'No baseline nerve testing on file - establishes nerve function before surgical planning.',
        source: 'always',
        status: 'needed',
        responsible: 'patient',
        dueBy: '2026-08-01',
        atRisk: false,
      },
      {
        name: 'MRI of Left Wrist and Hand',
        protocol: 'Non-contrast MRI; assess soft tissue and nerve continuity around the fall site.',
        rationale: 'Evaluates structural injury from the fall that may be compressing or injuring the nerve.',
        source: 'always',
        status: 'needed',
        responsible: 'patient',
        dueBy: '2026-08-03',
        atRisk: false,
      },
      {
        name: 'X-ray - Left Hand (2 views)',
        protocol: 'Standard 2-view radiograph of the left hand.',
        rationale: 'Rules out a fracture from the fall contributing to nerve compression.',
        source: 'always',
        status: 'needed',
        responsible: 'patient',
        dueBy: '2026-07-30',
        atRisk: false,
      },
    ],
    escalated: false,
    confidence: 'high',
    confidenceReason: 'All inputs extracted with high confidence from the Omari intake conversation.',
    overrideNodeIds: [],
    terminalOverridden: false,
    terminalCitation:
      'Acute post-traumatic hand numbness without baseline nerve testing warrants expedited ' +
      'peripheral nerve evaluation before any surgical decision.',
    confirmWithDrLi: false,
    flags: {},
    visitDate: VISIT_DATE,
  },
}
