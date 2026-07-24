import type { ReferralFixture } from '../../types'

/**
 * Dashboard — clean, high-confidence, in-scope referrals (the realistic
 * majority). Every extraction path replays through the real engine to a
 * confident destination; every variable value is an exact dukeNerveTree
 * branch condition value. All queue to 'ready'.
 *
 * Spread: Saltzman ×2, Hand Therapy ×2, Mithani ×3, Li ×3 (clinic add_workup
 * override terminal), Bhowmick ×2 (clinic set_urgency override terminal),
 * Neuromuscular ×1, Abd-El-Barr ×1. Mostly epic; two clean fax and one clean
 * phone (sparser, every fax/phone extraction has at least one value < 0.85).
 */

export const REFERRALS_CLEAN: ReferralFixture[] = [
  /* ── 0160 · Cubital tunnel, EMG abnormal → Dr. Saltzman ─────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0160',
      receivedAt: '2026-07-20T10:15:00',
      channel: 'epic',
      patient: {
        name: 'Mockridge, Harold',
        mrn: 'MRN-04471',
        dob: '1968-02-09',
        sex: 'M',
        phone: '(919) 555-0203',
      },
      referredBy: {
        provider: 'Dr. Elaine Torvald, MD',
        npi: '1730492817',
        practice: 'Durham Neurology Associates',
        phone: '(984) 555-0212',
        fax: '(984) 555-0213',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'EMG-confirmed right cubital tunnel syndrome; surgical evaluation.',
      clinicalNote:
        'Thank you for seeing this pleasant 58-year-old right-hand-dominant electrician with five months of numbness and tingling in the right ring and small fingers, worse with sustained elbow flexion on ladders. Exam shows a positive Tinel over the cubital tunnel with intact intrinsic bulk and no clawing. EMG/NCS from 7/8 (attached) demonstrates moderate ulnar slowing across the elbow. Elbow pads and activity modification have not helped; he would like to discuss decompression.',
      diagnoses: [{ icd10: 'G56.21', description: 'Lesion of ulnar nerve, right upper limb' }],
      attachments: [
        { title: 'EMG/NCS report — right upper extremity', type: 'emg', date: '2026-07-08', pages: 4 },
        { title: 'Neurology consult note', type: 'note', date: '2026-07-15', pages: 3 },
      ],
      structured: {
        vitals: { bp: '128/82', hr: '76', bmi: '29.1' },
        meds: ['amlodipine 5 mg daily', 'naproxen 220 mg PRN'],
        problems: ['Hypertension', 'Cubital tunnel syndrome, right'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.96 },
        presentationCategory: { value: 'compression', confidence: 0.94 },
        laterality: { value: 'one_side', confidence: 0.93 },
        primarySymptom: { value: 'numbness_tingling', confidence: 0.91 },
        symptomRegion: { value: 'elbow', confidence: 0.92 },
        nerveStudyStatus: { value: 'done_abnormal', confidence: 0.93 },
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
      visitDate: '2026-08-10',
      workupState: {
        'Nerve conduction studies + needle EMG (upper limbs)': {
          status: 'resulted',
          responsible: 'referring office',
          dueDaysBeforeVisit: 7,
        },
        'High-resolution nerve ultrasound (wrist & elbow)': {
          status: 'resulted',
          responsible: 'clinic',
          dueDaysBeforeVisit: 7,
        },
      },
    },
  },

  /* ── 0161 · Chronic CTS, EMG normal, night sx → Dr. Saltzman (clean fax) ── */
  {
    payload: {
      referralId: 'REF-2026-0161',
      receivedAt: '2026-07-17T08:42:00',
      channel: 'fax',
      patient: {
        name: 'Sampleton, Dorothy',
        mrn: 'MRN-04512',
        dob: '1954-11-23',
        sex: 'F',
        phone: '(919) 555-0218',
      },
      referredBy: {
        provider: 'Dr. Miles Okafor, MD',
        npi: '1842093761',
        practice: 'Wake Crossroads Family Medicine',
        phone: '(919) 555-0231',
        fax: '(919) 555-0232',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Left carpal tunnel, symptomatic > 6 months despite splint. Please eval for surgery.',
      clinicalNote:
        'Pt is 71 yo F c/o numbness/tingling L thumb-index-long x 7 mo, wakes her nightly, shakes hand out. Night splint x 3 mo without relief. EMG done locally 6/2026 read as normal. Please evaluate for carpal tunnel release. Records faxed.',
      diagnoses: [{ icd10: 'G56.02', description: 'Carpal tunnel syndrome, left upper limb' }],
      attachments: [
        { title: 'EMG/NCS report (faxed copy)', type: 'emg', date: '2026-06-12', pages: 2 },
        { title: 'Faxed referral letter', type: 'note', date: '2026-07-16', pages: 1 },
      ],
      structured: {
        meds: ['levothyroxine 75 mcg daily'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.84 },
        presentationCategory: { value: 'compression', confidence: 0.83 },
        laterality: { value: 'one_side', confidence: 0.82 },
        primarySymptom: { value: 'numbness_tingling', confidence: 0.84 },
        symptomRegion: { value: 'wrist', confidence: 0.82 },
        nerveStudyStatus: { value: 'done_normal', confidence: 0.83 },
        nightOrPositional: { value: 'yes', confidence: 0.84 },
        durationBand: { value: 'chronic_gt12wk', confidence: 0.82 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        laterality: 'note',
        primarySymptom: 'note',
        symptomRegion: 'note',
        nerveStudyStatus: 'attachment',
        nightOrPositional: 'note',
        durationBand: 'note',
      },
    },
    annotations: {
      visitDate: '2026-08-05',
      workupState: {
        'Nerve conduction studies + needle EMG (upper limbs)': {
          status: 'resulted',
          responsible: 'referring office',
          dueDaysBeforeVisit: 7,
        },
        'High-resolution nerve ultrasound (wrist & elbow)': {
          status: 'scheduled',
          responsible: 'clinic',
          dueDaysBeforeVisit: 3,
        },
      },
    },
  },

  /* ── 0162 · Early CTS, 4 weeks → Hand Therapy ───────────────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0162',
      receivedAt: '2026-07-22T13:05:00',
      channel: 'epic',
      patient: {
        name: 'Placeholder-Nguyen, Linh',
        mrn: 'MRN-04538',
        dob: '1992-04-17',
        sex: 'F',
        phone: '(984) 555-0244',
      },
      referredBy: {
        provider: 'Dr. Priya Vasan, MD',
        npi: '1957302846',
        practice: 'Cary Family Medicine',
        phone: '(919) 555-0114',
        fax: '(919) 555-0115',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'New right hand numbness, four weeks; requesting conservative management guidance.',
      clinicalNote:
        'Thanks for seeing this 34-year-old software analyst with about four weeks of intermittent numbness and tingling in the right thumb and index finger, clearly worse at night and when scrolling on her phone. Exam shows a positive Phalen with normal strength and sensation between episodes. No nerve studies yet — symptoms are early and I suspect she will do well with splinting and ergonomic coaching before any surgical conversation.',
      diagnoses: [{ icd10: 'G56.01', description: 'Carpal tunnel syndrome, right upper limb' }],
      attachments: [{ title: 'Office visit note', type: 'note', date: '2026-07-21', pages: 2 }],
      structured: {
        vitals: { bp: '112/70', hr: '64', bmi: '22.8' },
        meds: ['norethindrone 0.35 mg daily'],
        problems: ['Paresthesia of right hand'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.95 },
        presentationCategory: { value: 'compression', confidence: 0.92 },
        laterality: { value: 'one_side', confidence: 0.9 },
        primarySymptom: { value: 'numbness_tingling', confidence: 0.89 },
        symptomRegion: { value: 'wrist', confidence: 0.88 },
        nerveStudyStatus: { value: 'not_done', confidence: 0.9 },
        nightOrPositional: { value: 'yes', confidence: 0.91 },
        durationBand: { value: 'subacute_2_6wk', confidence: 0.87 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        laterality: 'note',
        primarySymptom: 'note',
        symptomRegion: 'note',
        nerveStudyStatus: 'note',
        nightOrPositional: 'note',
        durationBand: 'note',
      },
    },
  },

  /* ── 0163 · Mild new numbness, 10 days → Hand Therapy (clean phone) ─────── */
  {
    payload: {
      referralId: 'REF-2026-0163',
      receivedAt: '2026-07-23T16:20:00',
      channel: 'phone',
      patient: {
        name: 'Testerman, Cole',
        mrn: 'MRN-04590',
        dob: '2006-11-12',
        sex: 'M',
        phone: '(919) 555-0257',
      },
      referredBy: {
        provider: 'Nathan Pruitt, PA-C',
        npi: '1673048291',
        practice: 'Wake Forward Urgent Care — Holly Springs',
        phone: '(984) 555-0260',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Ten days of right wrist tingling after starting a new gym program; wants guidance.',
      clinicalNote:
        'Phone referral transcribed by intake staff: Mr. Pruitt called about a 19-year-old college student with about ten days of tingling in the right thumb and index finger after starting an aggressive new lifting program. Symptoms wake him occasionally at night and improve with rest. Exam at urgent care was normal apart from a mildly positive Phalen. He asks whether therapy and a splint are reasonable first steps.',
      diagnoses: [{ icd10: 'G56.01', description: 'Carpal tunnel syndrome, right upper limb' }],
      attachments: [],
      structured: {},
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.84 },
        presentationCategory: { value: 'compression', confidence: 0.83 },
        laterality: { value: 'one_side', confidence: 0.82 },
        primarySymptom: { value: 'numbness_tingling', confidence: 0.83 },
        symptomRegion: { value: 'wrist', confidence: 0.82 },
        nerveStudyStatus: { value: 'not_done', confidence: 0.83 },
        nightOrPositional: { value: 'yes', confidence: 0.82 },
        durationBand: { value: 'acute_lt2wk', confidence: 0.84 },
      },
      sources: {
        urgentRedFlag: 'referrer-stated',
        presentationCategory: 'referrer-stated',
        laterality: 'referrer-stated',
        primarySymptom: 'referrer-stated',
        symptomRegion: 'referrer-stated',
        nerveStudyStatus: 'referrer-stated',
        nightOrPositional: 'referrer-stated',
        durationBand: 'referrer-stated',
      },
    },
  },

  /* ── 0164 · Peroneal palsy, EMG abnormal → Dr. Mithani ──────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0164',
      receivedAt: '2026-07-21T09:30:00',
      channel: 'epic',
      patient: {
        name: 'Fakih-Demo, Rania',
        mrn: 'MRN-04627',
        dob: '1981-03-05',
        sex: 'F',
        phone: '(984) 555-0271',
      },
      referredBy: {
        provider: 'Dr. Hana Yoshida, MD',
        npi: '1265839407',
        practice: 'Raleigh Neurology Consultants',
        phone: '(919) 555-0275',
        fax: '(919) 555-0276',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Right common peroneal neuropathy on EMG with persistent dorsiflexion weakness.',
      clinicalNote:
        'Thank you for seeing this 45-year-old accountant with three months of right foot dorsiflexion weakness and numbness over the lateral lower leg after a period of rapid weight loss and habitual leg crossing. EMG/NCS from 7/6 (attached) shows a right common peroneal neuropathy at the fibular head with active denervation and minimal reinnervation. She has plateaued with an AFO and therapy; I would value a surgical opinion on decompression versus reconstruction.',
      diagnoses: [{ icd10: 'G57.31', description: 'Lesion of common peroneal nerve, right lower limb' }],
      attachments: [
        { title: 'EMG/NCS report — right lower extremity', type: 'emg', date: '2026-07-06', pages: 4 },
        { title: 'Neurology consult note', type: 'note', date: '2026-07-13', pages: 3 },
      ],
      structured: {
        vitals: { bp: '118/74', hr: '70', bmi: '24.6' },
        meds: ['sertraline 50 mg daily'],
        problems: ['Peroneal neuropathy, right', 'Recent 40-lb intentional weight loss'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.95 },
        presentationCategory: { value: 'compression', confidence: 0.92 },
        laterality: { value: 'one_side', confidence: 0.93 },
        primarySymptom: { value: 'weakness', confidence: 0.9 },
        symptomRegion: { value: 'lower_leg', confidence: 0.91 },
        nerveStudyStatus: { value: 'done_abnormal', confidence: 0.94 },
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
      visitDate: '2026-08-14',
      workupState: {
        'High-resolution nerve ultrasound and/or targeted MRI of the region': {
          status: 'resulted',
          responsible: 'clinic',
          dueDaysBeforeVisit: 7,
        },
        'EMG/NCS of the affected limb': {
          status: 'resulted',
          responsible: 'referring office',
          dueDaysBeforeVisit: 7,
        },
        'Bring operative records and prior imaging': {
          status: 'resulted',
          responsible: 'patient',
          dueDaysBeforeVisit: 7,
        },
      },
    },
  },

  /* ── 0165 · Old wrist laceration, residual deficit → Dr. Mithani ────────── */
  {
    payload: {
      referralId: 'REF-2026-0165',
      receivedAt: '2026-07-19T11:40:00',
      channel: 'epic',
      patient: {
        name: 'Specimen, Albert',
        mrn: 'MRN-04663',
        dob: '1987-05-14',
        sex: 'M',
        phone: '(919) 555-0288',
      },
      referredBy: {
        provider: 'Jordan Mays, PA-C',
        npi: '1489205736',
        practice: 'Triangle Orthopaedics',
        phone: '(919) 555-0291',
        fax: '(919) 555-0292',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Persistent median sensory deficit 8 months after right wrist laceration repair.',
      clinicalNote:
        'Referring this 39-year-old brewery worker seen in our fracture clinic. He sustained a deep glass laceration to the right volar wrist 8 months ago, repaired at an outside hospital the same night. He has persistent numbness in the thumb and index finger, a strongly positive Tinel at the scar that has stopped migrating distally, and early thenar weakness. We suspect incomplete median nerve recovery and would appreciate a reconstruction opinion.',
      diagnoses: [{ icd10: 'S64.21XS', description: 'Injury of median nerve at wrist and hand level of right arm, sequela' }],
      attachments: [
        { title: 'Outside operative note (faxed copy)', type: 'note', date: '2025-11-20', pages: 2 },
        { title: 'Clinic follow-up note', type: 'note', date: '2026-07-15', pages: 2 },
      ],
      structured: {
        meds: ['none'],
        problems: ['Laceration of right wrist with median nerve injury, repaired'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.95 },
        presentationCategory: { value: 'traumatic_chronic', confidence: 0.92 },
        symptomRegion: { value: 'wrist', confidence: 0.93 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        symptomRegion: 'note',
      },
    },
  },

  /* ── 0166 · Post-amputation stump neuroma → Dr. Mithani ─────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0166',
      receivedAt: '2026-07-16T15:10:00',
      channel: 'epic',
      patient: {
        name: 'Exampleton, Grace',
        mrn: 'MRN-04688',
        dob: '1963-12-01',
        sex: 'F',
        phone: '(984) 555-0303',
      },
      referredBy: {
        provider: 'Dr. Simone Alberts, MD',
        npi: '1596320874',
        practice: 'Garner Family Practice',
        phone: '(919) 555-0307',
        fax: '(919) 555-0308',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Focal stump pain 3 years after left below-knee amputation; suspected neuroma, TMR question.',
      clinicalNote:
        'Thank you for seeing this pleasant 62-year-old retired teacher, three years out from a left below-knee amputation after a crush injury. Over the past year she has developed a sharply localized electric pain at the lateral stump that limits prosthesis wear to two hours. There is a discrete exquisitely tender trigger point with a positive Tinel. Gabapentin helps only modestly. She read about targeted muscle reinnervation and asks whether she is a candidate.',
      diagnoses: [{ icd10: 'T87.34', description: 'Neuroma of amputation stump, left lower extremity' }],
      attachments: [
        { title: 'Office visit note', type: 'note', date: '2026-07-14', pages: 2 },
        { title: 'Prosthetics clinic letter', type: 'note', date: '2026-06-24', pages: 1 },
      ],
      structured: {
        vitals: { bp: '134/80', hr: '78', bmi: '31.2' },
        meds: ['gabapentin 600 mg TID', 'metformin 1000 mg BID'],
        problems: ['Left BKA (2023)', 'Type 2 diabetes mellitus', 'Stump neuroma pain'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.94 },
        presentationCategory: { value: 'pain_predominant', confidence: 0.9 },
        priorTraumaSurgery: { value: 'prior_surgery', confidence: 0.93 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        priorTraumaSurgery: 'structured',
      },
    },
  },

  /* ── 0167 · Brachial plexus injury, 4 months post MVC → Dr. Li (override) ─ */
  {
    payload: {
      referralId: 'REF-2026-0167',
      receivedAt: '2026-07-22T09:05:00',
      channel: 'epic',
      patient: {
        name: 'Nullford, Peter',
        mrn: 'MRN-04701',
        dob: '1997-08-21',
        sex: 'M',
        phone: '(919) 555-0316',
      },
      referredBy: {
        provider: 'Dr. Owen Fitzhugh, MD',
        npi: '1348572960',
        practice: 'Johnston Orthopaedic Trauma Clinic',
        phone: '(984) 555-0319',
        fax: '(984) 555-0320',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Right brachial plexus injury after motorcycle crash in March; plateaued recovery, nerve transfer question.',
      clinicalNote:
        'Referring this 28-year-old motorcyclist four months out from a high-speed crash with a right upper-trunk brachial plexus stretch injury. Shoulder abduction remains MRC 1 and elbow flexion MRC 2, with preserved hand function. EMG at three months showed severe upper-trunk involvement without voluntary units in deltoid or biceps. His fractures have healed and he is otherwise ready; given the time-sensitive window I would appreciate an expedited reconstruction and nerve-transfer evaluation.',
      diagnoses: [{ icd10: 'S14.3XXS', description: 'Injury of brachial plexus, sequela' }],
      attachments: [
        { title: 'EMG/NCS report — right upper extremity', type: 'emg', date: '2026-06-18', pages: 4 },
        { title: 'MRI brachial plexus report', type: 'imaging', date: '2026-06-25', pages: 2 },
        { title: 'Trauma clinic note', type: 'note', date: '2026-07-17', pages: 3 },
      ],
      structured: {
        vitals: { bp: '121/76', hr: '66' },
        meds: ['duloxetine 30 mg daily'],
        problems: ['Brachial plexus injury, right', 'Healed right clavicle fracture'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.93 },
        presentationCategory: { value: 'traumatic_chronic', confidence: 0.94 },
        symptomRegion: { value: 'shoulder_upper_arm', confidence: 0.92 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        symptomRegion: 'note',
      },
    },
  },

  /* ── 0168 · Stroke — functional restoration → Dr. Li (override, at-risk) ── */
  {
    payload: {
      referralId: 'REF-2026-0168',
      receivedAt: '2026-07-18T14:25:00',
      channel: 'epic',
      patient: {
        name: 'Demopoulos-Test, Maria',
        mrn: 'MRN-04745',
        dob: '1968-01-27',
        sex: 'F',
        phone: '(984) 555-0330',
      },
      referredBy: {
        provider: 'Dr. Camille Renard, MD',
        npi: '1750938246',
        practice: 'Bull City Physical Medicine & Rehabilitation',
        phone: '(984) 555-0334',
        fax: '(984) 555-0335',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Spastic left hand 18 months after right MCA stroke; candidacy for nerve transfer / functional restoration.',
      clinicalNote:
        'Thank you for evaluating this 58-year-old librarian, 18 months after a right MCA infarct with residual left hemiparesis. She has regained proximal strength but the left hand remains in a spastic flexed posture that blocks grasp and release despite botulinum toxin and intensive occupational therapy. Cognition and motivation are excellent. I am referring her to discuss surgical options for upper-limb functional restoration, including nerve transfer approaches, before her spasticity pattern becomes fixed.',
      diagnoses: [{ icd10: 'I69.354', description: 'Hemiplegia and hemiparesis following cerebral infarction affecting left non-dominant side' }],
      attachments: [
        { title: 'Rehabilitation progress note', type: 'note', date: '2026-07-10', pages: 3 },
        { title: 'MRI brain report (2025)', type: 'imaging', date: '2025-01-30', pages: 2 },
      ],
      structured: {
        vitals: { bp: '138/86', hr: '72' },
        meds: ['apixaban 5 mg BID', 'atorvastatin 40 mg daily', 'baclofen 10 mg TID'],
        problems: ['CVA with left hemiparesis (2025)', 'Upper limb spasticity', 'Atrial fibrillation'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.93 },
        presentationCategory: { value: 'functional_umn', confidence: 0.9 },
        umnHistory: { value: 'stroke', confidence: 0.95 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        umnHistory: 'structured',
      },
    },
    annotations: {
      visitDate: '2026-07-29',
      workupState: {
        'Extended EMG/NCS (plexus protocol)': {
          status: 'needed',
          responsible: 'clinic',
          dueDaysBeforeVisit: 3,
        },
        'MRI brachial plexus with contrast': {
          status: 'ordered',
          responsible: 'clinic',
          dueDaysBeforeVisit: 7,
        },
      },
    },
  },

  /* ── 0169 · Cervical SCI — restore grasp → Dr. Li (override, clean fax) ─── */
  {
    payload: {
      referralId: 'REF-2026-0169',
      receivedAt: '2026-07-15T10:50:00',
      channel: 'fax',
      patient: {
        name: 'Stubfield, Walter',
        mrn: 'MRN-04772',
        dob: '1985-02-11',
        sex: 'M',
        phone: '(919) 555-0342',
      },
      referredBy: {
        provider: 'Dr. Isaac Mba, MD',
        npi: '1602847395',
        practice: 'Triangle Rehabilitation Medicine',
        phone: '(984) 555-0346',
        fax: '(984) 555-0347',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'C6 incomplete SCI, 2 years out. Please evaluate for nerve transfer to improve grasp.',
      clinicalNote:
        '41 yo M, C6 AIS B injury 2/2024 after diving accident. Strong wrist extension, absent finger flexion bilaterally, R worse than L. Independent with transfers, motivated, wants improved grasp for self-catheterization and keyboard use. Plateaued in therapy. Please assess candidacy for nerve transfer reconstruction. Recent EMG and cervical MRI available on request.',
      diagnoses: [{ icd10: 'S14.109S', description: 'Unspecified injury at unspecified level of cervical spinal cord, sequela' }],
      attachments: [{ title: 'Faxed referral letter', type: 'note', date: '2026-07-14', pages: 2 }],
      structured: {
        meds: ['oxybutynin 5 mg BID', 'baclofen 20 mg TID'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.84 },
        presentationCategory: { value: 'functional_umn', confidence: 0.82 },
        umnHistory: { value: 'spinal_cord_injury', confidence: 0.83 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        umnHistory: 'note',
      },
    },
  },

  /* ── 0170 · Rapidly worsening cervical radiculopathy → Dr. Bhowmick
   *          (override: clinic set_urgency → urgent; at-risk workup) ───────── */
  {
    payload: {
      referralId: 'REF-2026-0170',
      receivedAt: '2026-07-23T08:15:00',
      channel: 'epic',
      patient: {
        name: 'Fauxwell, Brenda',
        mrn: 'MRN-04803',
        dob: '1972-09-30',
        sex: 'F',
        phone: '(919) 555-0355',
      },
      referredBy: {
        provider: 'Dr. Robert Ellison, MD',
        npi: '1837465029',
        practice: 'Brier Creek Internal Medicine',
        phone: '(919) 555-0359',
        fax: '(919) 555-0360',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'urgent',
      reasonForReferral: 'Cervical radiculopathy with grip weakness worsening week over week; requesting expedited spine evaluation.',
      clinicalNote:
        'I would appreciate an expedited evaluation of this 53-year-old dental hygienist with five weeks of left neck pain shooting down the arm into the thumb, clearly worsening week over week. In the last ten days she has developed measurable grip weakness and has begun dropping instruments at work. MRI from 7/20 (report attached) shows a large left C5-C6 disc extrusion with foraminal compromise. Given the trajectory I am concerned about a progressive deficit.',
      diagnoses: [
        { icd10: 'M54.12', description: 'Radiculopathy, cervical region' },
        { icd10: 'M50.222', description: 'Other cervical disc displacement at C5-C6 level' },
      ],
      attachments: [
        { title: 'MRI cervical spine report', type: 'imaging', date: '2026-07-20', pages: 2 },
        { title: 'Office visit note', type: 'note', date: '2026-07-22', pages: 2 },
      ],
      structured: {
        vitals: { bp: '126/80', hr: '74' },
        meds: ['prednisone taper (day 4)', 'cyclobenzaprine 5 mg QHS'],
        problems: ['Cervical disc extrusion C5-C6', 'Progressive left arm weakness'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.9 },
        presentationCategory: { value: 'compression', confidence: 0.89 },
        laterality: { value: 'one_side', confidence: 0.92 },
        primarySymptom: { value: 'mixed', confidence: 0.88 },
        symptomRegion: { value: 'neck_radiating', confidence: 0.93 },
        progression: { value: 'rapidly_worsening', confidence: 0.9 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        laterality: 'note',
        primarySymptom: 'note',
        symptomRegion: 'note',
        progression: 'note',
      },
    },
    annotations: {
      visitDate: '2026-07-27',
      workupState: {
        'MRI + CT of the cervical spine': {
          status: 'ordered',
          responsible: 'clinic',
          dueDaysBeforeVisit: 2,
        },
        'Standing + flexion–extension radiographs': {
          status: 'needed',
          responsible: 'clinic',
          dueDaysBeforeVisit: 2,
        },
      },
    },
  },

  /* ── 0171 · Slow progression, severe functional loss → Dr. Bhowmick
   *          (override: clinic set_urgency → urgent) ────────────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0171',
      receivedAt: '2026-07-20T15:45:00',
      channel: 'epic',
      patient: {
        name: 'Mocklin, Derek',
        mrn: 'MRN-04841',
        dob: '1959-04-08',
        sex: 'M',
        phone: '(984) 555-0368',
      },
      referredBy: {
        provider: 'Dr. Farah Qureshi, MD',
        npi: '1928374651',
        practice: 'Apex Primary Care',
        phone: '(919) 555-0372',
        fax: '(919) 555-0373',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Progressive cervical radiculopathy with severe left arm functional loss; surgical evaluation.',
      clinicalNote:
        'Thank you for seeing this 67-year-old retired machinist with eight months of gradually progressive left neck pain radiating down the arm, now with severe weakness — he can no longer lift the arm above shoulder height and has stopped driving because he cannot manage the wheel. MRI shows multilevel spondylosis with severe left C5-C6 and C6-C7 foraminal stenosis. Conservative care including two epidural injections has failed. He understands surgery is likely on the table and would like the discussion.',
      diagnoses: [
        { icd10: 'M47.22', description: 'Spondylosis with radiculopathy, cervical region' },
        { icd10: 'M50.122', description: 'Cervical disc disorder at C5-C6 level with radiculopathy' },
      ],
      attachments: [
        { title: 'MRI cervical spine report', type: 'imaging', date: '2026-07-01', pages: 3 },
        { title: 'Office visit note', type: 'note', date: '2026-07-18', pages: 2 },
      ],
      structured: {
        vitals: { bp: '142/88', hr: '80', bmi: '30.4' },
        meds: ['losartan 50 mg daily', 'tramadol 50 mg PRN'],
        problems: ['Cervical spondylosis with radiculopathy', 'Hypertension'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.95 },
        presentationCategory: { value: 'compression', confidence: 0.9 },
        laterality: { value: 'one_side', confidence: 0.91 },
        primarySymptom: { value: 'weakness', confidence: 0.89 },
        symptomRegion: { value: 'neck_radiating', confidence: 0.92 },
        progression: { value: 'slowly_worsening', confidence: 0.88 },
        functionalImpact: { value: 'severe_loss', confidence: 0.9 },
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
  },

  /* ── 0172 · Bilateral hand + foot numbness → Neuromuscular Neurology ────── */
  {
    payload: {
      referralId: 'REF-2026-0172',
      receivedAt: '2026-07-22T11:20:00',
      channel: 'epic',
      patient: {
        name: 'Samplewicz, Irene',
        mrn: 'MRN-04876',
        dob: '1950-06-19',
        sex: 'F',
        phone: '(919) 555-0381',
      },
      referredBy: {
        provider: 'Dr. Leonard Boyce, MD',
        npi: '1583920467',
        practice: 'North Raleigh Internal Medicine',
        phone: '(919) 555-0385',
        fax: '(919) 555-0386',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Symmetric bilateral hand and foot numbness; suspect polyneuropathy, needs EMG characterization.',
      clinicalNote:
        'Thank you for seeing this 76-year-old retired florist with roughly a year of slowly progressive numbness and tingling involving both hands and both feet in a stocking-glove pattern. Reflexes are diminished at the ankles and vibration sense is reduced distally. B12, TSH, and SPEP are unremarkable; A1c is 5.4. I suspect a length-dependent polyneuropathy and would appreciate EMG characterization before any further workup.',
      diagnoses: [{ icd10: 'G62.9', description: 'Polyneuropathy, unspecified' }],
      attachments: [
        { title: 'Office visit note', type: 'note', date: '2026-07-20', pages: 2 },
        { title: 'Laboratory results', type: 'labs', date: '2026-07-08', pages: 3 },
      ],
      structured: {
        vitals: { bp: '136/82', hr: '68' },
        meds: ['amlodipine 10 mg daily', 'vitamin D 2000 IU daily'],
        problems: ['Paresthesia, bilateral hands and feet', 'Hypertension'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.93 },
        presentationCategory: { value: 'compression', confidence: 0.9 },
        laterality: { value: 'both_sides', confidence: 0.92 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        laterality: 'note',
      },
    },
  },

  /* ── 0173 · Cervical radiculopathy, daily interference → Dr. Abd-El-Barr ── */
  {
    payload: {
      referralId: 'REF-2026-0173',
      receivedAt: '2026-07-21T16:35:00',
      channel: 'epic',
      patient: {
        name: 'Fakelund, Roger',
        mrn: 'MRN-04902',
        dob: '1978-03-22',
        sex: 'M',
        phone: '(984) 555-0394',
      },
      referredBy: {
        provider: 'Dr. Tomás Herrera, MD',
        npi: '1740596283',
        practice: 'Fuquay-Varina Family Medicine',
        phone: '(919) 555-0398',
        fax: '(919) 555-0399',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'C6 radiculopathy on MRI, worsening despite PT; interferes with work. Spine surgical evaluation.',
      clinicalNote:
        'Thanks for seeing this 48-year-old warehouse supervisor with four months of right neck pain radiating below the elbow into the thumb, slowly worsening despite eight weeks of physical therapy and an NSAID course. Symptoms now interfere with lifting at work and with sleep most nights, though strength remains full. MRI from 7/10 (attached) shows a right paracentral C5-C6 disc protrusion with moderate foraminal stenosis correlating with his dermatome. Referring for minimally invasive spine surgical evaluation.',
      diagnoses: [
        { icd10: 'M54.12', description: 'Radiculopathy, cervical region' },
        { icd10: 'M50.122', description: 'Cervical disc disorder at C5-C6 level with radiculopathy' },
      ],
      attachments: [
        { title: 'MRI cervical spine report', type: 'imaging', date: '2026-07-10', pages: 2 },
        { title: 'Physical therapy discharge summary', type: 'note', date: '2026-07-03', pages: 2 },
      ],
      structured: {
        vitals: { bp: '124/78', hr: '71', bmi: '27.9' },
        meds: ['meloxicam 15 mg daily'],
        problems: ['Cervical radiculopathy, right'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.96 },
        presentationCategory: { value: 'compression', confidence: 0.9 },
        laterality: { value: 'one_side', confidence: 0.93 },
        primarySymptom: { value: 'pain', confidence: 0.91 },
        symptomRegion: { value: 'neck_radiating', confidence: 0.9 },
        progression: { value: 'slowly_worsening', confidence: 0.87 },
        functionalImpact: { value: 'interferes_daily', confidence: 0.89 },
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
      visitDate: '2026-08-11',
      workupState: {
        'MRI cervical (± lumbar) spine without contrast': {
          status: 'resulted',
          responsible: 'referring office',
          dueDaysBeforeVisit: 7,
        },
        'Standing radiographs of the symptomatic spine': {
          status: 'resulted',
          responsible: 'clinic',
          dueDaysBeforeVisit: 7,
        },
      },
    },
  },
]
