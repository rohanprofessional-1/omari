import type { ReferralFixture } from '../../types'
import { REFERRALS_CLEAN } from './referralsClean'
import { REFERRALS_EDGE } from './referralsEdge'
import { REFERRALS_OUT_OF_SCOPE } from './referralsOutOfScope'

/**
 * Dashboard — referral fixture index.
 *
 * The five original seed archetypes live in this file; the expanded set is
 * split for reviewability into referralsClean (the high-confidence majority),
 * referralsEdge (missing-variable / ambiguous / mismatch / escalation), and
 * referralsOutOfScope. REFERRAL_FIXTURES at the bottom concatenates them all —
 * the adapter and tests import only that.
 *
 * Every extraction uses the EXACT variable keys and branch condition values
 * from dukeNerveTree — the derivation test replays each one through the real
 * engine and pins where it lands. All names are obviously fictional; MRNs,
 * NPIs, and ICD-10s are plausible-looking fakes. Dates are pinned relative to
 * DEMO_NOW (2026-07-24T09:00).
 *
 * Seed archetypes:
 *  1. Clean high-confidence in-scope  → routes (Dr. Saltzman)      [epic]
 *  2. Missing EMG                     → incomplete at the EMG gate [fax]
 *  3. Ambiguous spine-vs-peripheral   → routed but needs judgment  [epic]
 *  4. Rotator cuff — out of scope     → redirect                   [fax]
 *  5. Acute trauma red flag           → urgent escalation          [phone]
 */

const SEED_FIXTURES: ReferralFixture[] = [
  /* 1 ── Clean, high-confidence carpal tunnel → Dr. Saltzman ───────────────
   *
   * ⚠️ BOUND TO THE DEMO PATIENT. src/auth/demoUsers.ts pins the patient
   * account to MRN-4839201, so this is the referral the patient view shows.
   * Intake doesn't create referrals yet (nothing is POSTed when the Runner
   * finishes, and there's no /referrals endpoint), so the patient's status and
   * appointments screens read this fixture instead. Changing the MRN or the
   * required workup here changes what the patient sees. */
  {
    payload: {
      referralId: 'REF-2026-0142',
      receivedAt: '2026-07-21T14:32:00',
      channel: 'epic',
      patient: {
        name: 'Testfield, Marla',
        mrn: 'MRN-4839201',
        dob: '1974-03-12',
        sex: 'F',
        phone: '(919) 555-0182',
      },
      referredBy: {
        provider: 'Dr. Alan Pemberly',
        npi: '1740283915',
        practice: 'Cary Family Medicine',
        phone: '(919) 555-0114',
        fax: '(919) 555-0115',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'EMG-confirmed right carpal tunnel syndrome; failed splinting; surgical evaluation.',
      clinicalNote:
        'Thanks for seeing this pleasant 52-year-old right-hand-dominant administrative assistant with about four months of numbness and tingling in the right thumb, index, and long fingers, worse at night and while driving. Phalen and Tinel are positive at the right wrist with no thenar wasting. EMG/NCS on 6/30/2026 showed moderate right median neuropathy at the wrist. She has faithfully worn a night splint for eight weeks without relief and would like to discuss surgical options.',
      diagnoses: [{ icd10: 'G56.01', description: 'Carpal tunnel syndrome, right upper limb' }],
      attachments: [
        { title: 'EMG/NCS report — right upper extremity', type: 'emg', date: '2026-06-30', pages: 3 },
        { title: 'Office visit note', type: 'note', date: '2026-07-15', pages: 2 },
      ],
      structured: {
        vitals: { bp: '122/78', hr: '72', bmi: '27.4' },
        meds: ['lisinopril 10 mg daily', 'ibuprofen 400 mg PRN'],
        problems: ['Hypertension', 'Carpal tunnel syndrome, right'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.97 },
        presentationCategory: { value: 'compression', confidence: 0.95 },
        laterality: { value: 'one_side', confidence: 0.94 },
        primarySymptom: { value: 'numbness_tingling', confidence: 0.92 },
        symptomRegion: { value: 'wrist', confidence: 0.93 },
        nerveStudyStatus: { value: 'done_abnormal', confidence: 0.9 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        laterality: 'note',
        primarySymptom: 'note',
        symptomRegion: 'note',
        nerveStudyStatus: 'attachment',
      },
    },
    annotations: {
      // The demo patient's referral. A routine first consultation with a nerve
      // surgeon is genuinely two months out, and that wait is the window the
      // patient screens schedule tests into — so the fixture says two months
      // rather than two weeks.
      visitDate: '2026-09-22',
      workupState: {
        'Nerve conduction studies + needle EMG (upper limbs)': {
          status: 'resulted',
          responsible: 'referring office',
          dueDaysBeforeVisit: 7,
        },
      },
    },
  },

  /* 2 ── Missing EMG → engine halts at the EMG gate ──────────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0147',
      receivedAt: '2026-07-18T09:10:00',
      channel: 'fax',
      patient: {
        name: 'Nulligan, Robert',
        mrn: 'MRN-2217743',
        dob: '1961-08-30',
        sex: 'M',
        phone: '(910) 555-0147',
      },
      referredBy: {
        provider: 'Dr. Priya Vaswani',
        npi: '1568374920',
        practice: 'Harnett Primary Care Associates',
        phone: '(910) 555-0121',
        fax: '(910) 555-0122',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Left hand numbness, please evaluate.',
      clinicalNote:
        'Please evaluate this 64-year-old gentleman with several months of numbness and tingling in the left hand, mostly the ring and small fingers. He occasionally drops small objects. Exam in our office was otherwise unremarkable. Appreciate your assessment and recommendations.',
      diagnoses: [{ icd10: 'G56.21', description: 'Lesion of ulnar nerve, right upper limb' }],
      attachments: [{ title: 'Faxed referral letter', type: 'note', date: '2026-07-17', pages: 1 }],
      structured: {},
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.86 },
        presentationCategory: { value: 'compression', confidence: 0.82 },
        laterality: { value: 'one_side', confidence: 0.81 },
        primarySymptom: { value: 'numbness_tingling', confidence: 0.84 },
        symptomRegion: { value: 'hand_fingers', confidence: 0.83 },
        // nerveStudyStatus deliberately absent — the fax never mentions EMG/NCS.
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        laterality: 'note',
        primarySymptom: 'note',
        symptomRegion: 'note',
      },
    },
  },

  /* 3 ── Ambiguous spine vs peripheral → routed, needs judgment ──────────── */
  {
    payload: {
      referralId: 'REF-2026-0151',
      receivedAt: '2026-07-19T11:05:00',
      channel: 'epic',
      patient: {
        name: 'Quillbrook, Janet',
        mrn: 'MRN-7754310',
        dob: '1968-11-02',
        sex: 'F',
        phone: '(984) 555-0139',
      },
      referredBy: {
        provider: 'Dr. Marcus Oyelaran',
        npi: '1893746251',
        practice: 'Durham Internal Medicine Group',
        phone: '(984) 555-0161',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Right arm pain and tingling, possible carpal tunnel vs cervical radiculopathy.',
      clinicalNote:
        'Thanks for seeing this pleasant 57-year-old teacher with three months of right-sided neck and arm pain that shoots from the neck down toward the hand, gradually worsening and now interfering with sleep and grading papers. There is intermittent tingling in the thumb and index finger. Honestly the picture is hard to pin down — it could be a cervical root problem or a peripheral entrapment. No imaging or nerve studies yet.',
      diagnoses: [
        { icd10: 'M54.12', description: 'Radiculopathy, cervical region' },
        { icd10: 'G56.00', description: 'Carpal tunnel syndrome, unspecified upper limb' },
      ],
      attachments: [{ title: 'Office visit note', type: 'note', date: '2026-07-18', pages: 2 }],
      structured: {
        vitals: { bp: '131/84', hr: '68' },
        meds: ['meloxicam 15 mg daily'],
        problems: ['Cervicalgia', 'Paresthesia of right arm'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.95 },
        presentationCategory: { value: 'compression', confidence: 0.55 },
        laterality: { value: 'one_side', confidence: 0.9 },
        primarySymptom: { value: 'pain', confidence: 0.88 },
        symptomRegion: { value: 'neck_radiating', confidence: 0.85 },
        progression: { value: 'slowly_worsening', confidence: 0.82 },
        functionalImpact: { value: 'interferes_daily', confidence: 0.86 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        laterality: 'note',
        primarySymptom: 'note',
        symptomRegion: 'note',
        progression: 'note',
        functionalImpact: 'note',
      },
    },
    annotations: {
      flags: { ambiguousBetween: ['Dr. Muhammad Abd-El-Barr', 'Dr. Eliana Saltzman'] },
    },
  },

  /* 4 ── Rotator cuff — likely out of scope ──────────────────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0155',
      receivedAt: '2026-07-14T16:48:00',
      channel: 'fax',
      patient: {
        name: 'Sandovine, Gregory',
        mrn: 'MRN-9034487',
        dob: '1959-05-21',
        sex: 'M',
        phone: '(336) 555-0173',
      },
      referredBy: {
        provider: 'Dr. Helen Croftwood',
        npi: '1327465890',
        practice: 'Alamance Family Practice',
        phone: '(336) 555-0128',
        fax: '(336) 555-0129',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Right shoulder pain and weakness, rule out nerve involvement.',
      clinicalNote:
        'Referring this 67-year-old retired painter with six months of right shoulder pain, worse with overhead activity, and difficulty lifting the arm. MRI of the shoulder on 7/2/2026 shows a full-thickness supraspinatus tear with mild retraction. He asked about nerve testing, so I am sending him your way to be safe. Appreciate your thoughts.',
      diagnoses: [{ icd10: 'M75.121', description: 'Complete rotator cuff tear or rupture of right shoulder, not specified as traumatic' }],
      attachments: [
        { title: 'MRI right shoulder report', type: 'imaging', date: '2026-07-02', pages: 2 },
        { title: 'Faxed referral letter', type: 'note', date: '2026-07-14', pages: 1 },
      ],
      structured: {
        meds: ['atorvastatin 20 mg daily', 'acetaminophen PRN'],
        problems: ['Hyperlipidemia', 'Rotator cuff tear, right'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.9 },
        presentationCategory: { value: 'compression', confidence: 0.8 },
        laterality: { value: 'one_side', confidence: 0.88 },
        primarySymptom: { value: 'pain', confidence: 0.9 },
        symptomRegion: { value: 'shoulder_upper_arm', confidence: 0.92 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        laterality: 'note',
        primarySymptom: 'note',
        symptomRegion: 'attachment',
      },
    },
    annotations: {
      scope: {
        kind: 'out_of_scope',
        suggestedRedirect: 'Sports Medicine / Shoulder service',
        reason: 'Rotator cuff pathology — not a peripheral nerve condition',
      },
    },
  },

  /* 5 ── Acute traumatic nerve injury → urgent fast-track escalation ─────── */
  {
    payload: {
      referralId: 'REF-2026-0158',
      receivedAt: '2026-07-24T07:45:00',
      channel: 'phone',
      patient: {
        name: 'Farrowgate, Dennis',
        mrn: 'MRN-1120956',
        dob: '1987-01-16',
        sex: 'M',
        phone: '(919) 555-0166',
      },
      referredBy: {
        provider: 'Dr. Sylvia Marrowbend',
        npi: '1481937265',
        practice: 'Wake Urgent Care — Garner',
        phone: '(919) 555-0190',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'urgent',
      reasonForReferral: 'Table saw laceration to right volar forearm yesterday with new numbness in the hand.',
      clinicalNote:
        'Phone referral transcribed by intake staff: Dr. Marrowbend called regarding a 39-year-old carpenter seen this morning after a table saw laceration to the right volar forearm yesterday evening. The wound was closed at urgent care, but he has new numbness in the thumb and index finger and cannot flex the thumb tip. She is worried about a median nerve and flexor tendon injury and asks for evaluation within the urgent access window.',
      diagnoses: [{ icd10: 'S51.812A', description: 'Laceration without foreign body of left forearm, initial encounter' }],
      attachments: [{ title: 'Urgent care wound photo', type: 'photo', date: '2026-07-24' }],
      structured: {},
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'acute_trauma', confidence: 0.96 },
      },
      sources: {
        urgentRedFlag: 'referrer-stated',
      },
    },
  },
]

/** The full mock queue: 5 seeds + 14 clean + 11 edge + 2 out-of-scope = 32. */
export const REFERRAL_FIXTURES: ReferralFixture[] = [
  ...SEED_FIXTURES,
  ...REFERRALS_CLEAN,
  ...REFERRALS_EDGE,
  ...REFERRALS_OUT_OF_SCOPE,
]
