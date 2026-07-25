import type { ReferralFixture } from '../../types'

/**
 * Dashboard — referrals the clinic should politely redirect.
 *
 * Both carry annotations.scope (kind: 'out_of_scope' + suggestedRedirect +
 * reason); the engine still replays their extractions for transparency, but
 * the scope annotation wins in deriveTreeResult. With the rotator-cuff seed
 * (REF-2026-0155) these make three out-of-scope referrals, all fax — the
 * channel that misdirected referrals actually arrive on.
 */

export const REFERRALS_OUT_OF_SCOPE: ReferralFixture[] = [
  /* ── 0185 · Axial low back pain, no radicular features ──────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0185',
      receivedAt: '2026-07-12T10:05:00',
      channel: 'fax',
      patient: {
        name: 'Dummerston, Kyle',
        mrn: 'MRN-05238',
        dob: '1988-08-15',
        sex: 'M',
        phone: '(919) 555-0512',
      },
      referredBy: {
        provider: 'Dr. Wallace Frome, MD',
        npi: '1725390846',
        practice: 'Sanford Walk-In & Family Care',
        phone: '(919) 555-0516',
        fax: '(919) 555-0517',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Chronic low back pain, failed PT; please evaluate for nerve involvement.',
      clinicalNote:
        'Pt c/o axial low back pain x 8 mo. No leg pain, no numbness, no weakness, SLR negative bilat. PT x 8 wk with minimal relief. MRI L-spine — mild degenerative changes only, no stenosis or nerve root compression. Pt requesting to see a nerve specialist. Please eval.',
      diagnoses: [{ icd10: 'M54.50', description: 'Low back pain, unspecified' }],
      attachments: [
        { title: 'MRI lumbar spine report (faxed copy)', type: 'imaging', date: '2026-06-19', pages: 2 },
        { title: 'Faxed referral letter', type: 'note', date: '2026-07-11', pages: 1 },
      ],
      structured: {
        meds: ['cyclobenzaprine 5 mg QHS', 'ibuprofen 600 mg PRN'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.86 },
        presentationCategory: { value: 'pain_predominant', confidence: 0.8 },
        priorTraumaSurgery: { value: 'none', confidence: 0.78 },
        systemicContext: { value: 'none', confidence: 0.77 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        priorTraumaSurgery: 'note',
        systemicContext: 'note',
      },
    },
    annotations: {
      scope: {
        kind: 'out_of_scope',
        suggestedRedirect: 'Spine Physiatry / Physical Therapy',
        reason: 'Axial low back pain without radicular or peripheral-nerve features — not a peripheral nerve condition',
      },
    },
  },

  /* ── 0186 · Trigger finger — mechanical, not neurologic ─────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0186',
      receivedAt: '2026-07-16T14:45:00',
      channel: 'fax',
      patient: {
        name: 'Fake-Winslow, Tamara',
        mrn: 'MRN-05264',
        dob: '1983-02-27',
        sex: 'F',
        phone: '(984) 555-0523',
      },
      referredBy: {
        provider: 'Dr. Percy Halloway, MD',
        npi: '1538067294',
        practice: 'Mebane Family Practice',
        phone: '(919) 555-0527',
        fax: '(919) 555-0528',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Right ring finger locking and clicking; ?nerve issue. Please evaluate.',
      clinicalNote:
        'Pt c/o R ring finger catching/locking, worst in the AM, x 3 mo. Painful nodule palpable at the A1 pulley. No numbness or tingling. Pt convinced it is a "pinched nerve" and requested the nerve clinic. Please advise.',
      diagnoses: [{ icd10: 'M65.341', description: 'Trigger finger, right ring finger' }],
      attachments: [{ title: 'Faxed referral letter', type: 'note', date: '2026-07-15', pages: 1 }],
      structured: {
        meds: ['none'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.84 },
        presentationCategory: { value: 'compression', confidence: 0.72 },
        laterality: { value: 'one_side', confidence: 0.84 },
        primarySymptom: { value: 'pain', confidence: 0.8 },
        symptomRegion: { value: 'hand_fingers', confidence: 0.83 },
        nerveStudyStatus: { value: 'not_done', confidence: 0.81 },
        nightOrPositional: { value: 'no', confidence: 0.74 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        laterality: 'note',
        primarySymptom: 'note',
        symptomRegion: 'note',
        nerveStudyStatus: 'note',
        nightOrPositional: 'note',
      },
    },
    annotations: {
      scope: {
        kind: 'out_of_scope',
        suggestedRedirect: 'General hand surgery clinic (trigger finger)',
        reason: 'Stenosing tenosynovitis (trigger finger) — a mechanical tendon problem, not a peripheral nerve condition',
      },
    },
  },
]
