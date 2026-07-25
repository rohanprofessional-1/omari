import type { ReferralFixture } from '../../types'

/**
 * Dashboard — edge-case referrals: the queue's honest middle.
 *
 * Every value is an exact dukeNerveTree branch condition value; every routing
 * claim below is engine-verified (see deriveTreeResult.test.ts).
 *
 *  - 0174–0176  missing one gating variable → engine halts incomplete
 *               (no-EMG ×1 more, unknown duration ×1, unclear laterality ×1;
 *               the fax no-EMG seed 0147 is the fourth)
 *  - 0177–0178  ambiguous: full path but one pivotal variable at 0.45–0.62,
 *               flagged ambiguousBetween two real destinations
 *  - 0179–0180  stated-reason mismatches: the referral asks for X, the
 *               clinical substance routes to Y (flags.statedReasonMismatch)
 *  - 0181–0182  urgent red-flag values → fast-track escalations
 *               (0181 doubles as the third mismatch: "routine lump" that is
 *               actually growing fast)
 *  - 0183–0184  no confident path → esc_ambiguous (one 'unclear' value, one
 *               functional story without any UMN event)
 */

export const REFERRALS_EDGE: ReferralFixture[] = [
  /* ── 0174 · Forearm weakness, EMG ordered but not done → halts at EMG gate ─ */
  {
    payload: {
      referralId: 'REF-2026-0174',
      receivedAt: '2026-07-22T10:40:00',
      channel: 'epic',
      patient: {
        name: 'Fakenham, Travis',
        mrn: 'MRN-04931',
        dob: '1979-10-02',
        sex: 'M',
        phone: '(919) 555-0402',
      },
      referredBy: {
        provider: 'Dr. Anita Rowley, MD',
        npi: '1523098467',
        practice: 'Clayton Primary Care',
        phone: '(919) 555-0406',
        fax: '(919) 555-0407',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Right forearm pain with finger-extension weakness; suspect posterior interosseous nerve involvement.',
      clinicalNote:
        'Thank you for seeing this 46-year-old HVAC technician with six weeks of deep aching pain in the proximal right forearm and progressive difficulty extending the fingers, though wrist extension is preserved. There is tenderness over the supinator without sensory loss. I am concerned about a posterior interosseous nerve entrapment. EMG/NCS has been ordered but the first available slot is mid-August; I did not want to hold the referral for it.',
      diagnoses: [{ icd10: 'G56.31', description: 'Lesion of radial nerve, right upper limb' }],
      attachments: [{ title: 'Office visit note', type: 'note', date: '2026-07-21', pages: 2 }],
      structured: {
        vitals: { bp: '130/84', hr: '75', bmi: '28.6' },
        meds: ['ibuprofen 600 mg PRN'],
        problems: ['Forearm pain, right', 'Weakness of finger extension'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.93 },
        presentationCategory: { value: 'compression', confidence: 0.89 },
        laterality: { value: 'one_side', confidence: 0.91 },
        primarySymptom: { value: 'weakness', confidence: 0.88 },
        symptomRegion: { value: 'forearm', confidence: 0.9 },
        // nerveStudyStatus deliberately absent — EMG is ordered but not done,
        // and no result exists anywhere in the packet.
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

  /* ── 0175 · EMG-normal night numbness, duration undocumented → halts at
   *          the duration gate ─────────────────────────────────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0175',
      receivedAt: '2026-07-19T13:55:00',
      channel: 'fax',
      patient: {
        name: 'Testwell, Sandra',
        mrn: 'MRN-04958',
        dob: '1957-12-05',
        sex: 'F',
        phone: '(984) 555-0411',
      },
      referredBy: {
        provider: 'Dr. Gordon Pyle, MD',
        npi: '1610472938',
        practice: 'Smithfield Family Practice',
        phone: '(919) 555-0415',
        fax: '(919) 555-0416',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Left hand numbness, EMG normal. Please evaluate.',
      clinicalNote:
        'Pt c/o numbness L hand, thumb + index, wakes her at night, shakes hand out. EMG 6/2026 outside — read as normal. Duration not documented, pt a poor historian ("a while now"). Splint not tried. Please eval and advise.',
      diagnoses: [{ icd10: 'G56.02', description: 'Carpal tunnel syndrome, left upper limb' }],
      attachments: [
        { title: 'EMG/NCS report (faxed copy)', type: 'emg', date: '2026-06-22', pages: 2 },
        { title: 'Faxed referral letter', type: 'note', date: '2026-07-18', pages: 1 },
      ],
      structured: {
        meds: ['omeprazole 20 mg daily'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.84 },
        presentationCategory: { value: 'compression', confidence: 0.82 },
        laterality: { value: 'one_side', confidence: 0.8 },
        primarySymptom: { value: 'numbness_tingling', confidence: 0.83 },
        symptomRegion: { value: 'hand_fingers', confidence: 0.81 },
        nerveStudyStatus: { value: 'done_normal', confidence: 0.8 },
        nightOrPositional: { value: 'yes', confidence: 0.82 },
        // durationBand deliberately absent — "a while now" cannot be banded.
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        laterality: 'note',
        primarySymptom: 'note',
        symptomRegion: 'note',
        nerveStudyStatus: 'attachment',
        nightOrPositional: 'note',
      },
    },
  },

  /* ── 0176 · Numb hands, laterality unclear → halts at the laterality gate ── */
  {
    payload: {
      referralId: 'REF-2026-0176',
      receivedAt: '2026-07-21T09:25:00',
      channel: 'fax',
      patient: {
        name: 'Nullbaum, Frieda',
        mrn: 'MRN-04977',
        dob: '1942-03-29',
        sex: 'F',
        phone: '(919) 555-0423',
      },
      referredBy: {
        provider: 'Margaret Chu, FNP',
        npi: '1749205831',
        practice: 'Wendell Family Health',
        phone: '(919) 555-0427',
        fax: '(919) 555-0428',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Hand numbness in elderly patient. Please evaluate.',
      clinicalNote:
        'Pt 84 yo c/o numb hand x several months. Unclear from visit whether one or both sides — pt says "the hand goes dead" but daughter reports she shakes BOTH hands out at night. Possible old CTS release on one side, records unavailable. Please eval.',
      diagnoses: [{ icd10: 'R20.2', description: 'Paresthesia of skin' }],
      attachments: [{ title: 'Faxed referral letter', type: 'note', date: '2026-07-20', pages: 1 }],
      structured: {
        meds: ['donepezil 10 mg daily', 'lisinopril 20 mg daily'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.82 },
        presentationCategory: { value: 'compression', confidence: 0.78 },
        primarySymptom: { value: 'numbness_tingling', confidence: 0.8 },
        symptomRegion: { value: 'hand_fingers', confidence: 0.79 },
        // laterality deliberately absent — the fax genuinely contradicts itself.
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        primarySymptom: 'note',
        symptomRegion: 'note',
      },
    },
  },

  /* ── 0177 · Post-fall wrist pain, injury link uncertain → Dr. Mithani,
   *          but genuinely straddles surgery vs pain medicine ──────────────── */
  {
    payload: {
      referralId: 'REF-2026-0177',
      receivedAt: '2026-07-23T15:10:00',
      channel: 'epic',
      patient: {
        name: 'Mockford, Damian',
        mrn: 'MRN-05004',
        dob: '1990-06-14',
        sex: 'M',
        phone: '(984) 555-0433',
      },
      referredBy: {
        provider: 'Dr. Lena Vostrikova, MD',
        npi: '1857392064',
        practice: 'Knightdale Internal Medicine',
        phone: '(919) 555-0437',
        fax: '(919) 555-0438',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Chronic left wrist and hand nerve pain after a fall 18 months ago; surgical target vs pain management guidance.',
      clinicalNote:
        'Thanks for seeing this 36-year-old roofer with burning pain over the dorsoradial left wrist and thumb base since a ladder fall 18 months ago that also caused a casted distal radius fracture. The fracture healed well, and honestly I cannot tell whether this is a discrete superficial radial nerve injury from the fall or a broader chronic pain picture — the pain map has spread somewhat and light touch bothers him. Gabapentin gives partial relief. If there is a surgical target I would love to know; if not, he needs a structured pain plan.',
      diagnoses: [
        { icd10: 'G56.42', description: 'Causalgia of left upper limb' },
        { icd10: 'M25.532', description: 'Pain in left wrist' },
      ],
      attachments: [
        { title: 'XR left wrist report', type: 'imaging', date: '2026-07-10', pages: 1 },
        { title: 'Office visit note', type: 'note', date: '2026-07-22', pages: 2 },
      ],
      structured: {
        vitals: { bp: '119/76', hr: '69' },
        meds: ['gabapentin 300 mg TID'],
        problems: ['Chronic left wrist pain', 'Healed left distal radius fracture'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.93 },
        presentationCategory: { value: 'pain_predominant', confidence: 0.9 },
        // Pivotal and genuinely soft: is this pain FROM the old injury (a
        // surgical neuroma target) or chronic pain that happens to postdate it?
        priorTraumaSurgery: { value: 'recent_injury', confidence: 0.55 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        priorTraumaSurgery: 'note',
      },
    },
    annotations: {
      flags: { ambiguousBetween: ['Dr. Suhail Mithani', 'Dr. Kevin Vorenkamp'] },
    },
  },

  /* ── 0178 · Chronic hand numbness, old nerve test result unknown →
   *          Dr. Saltzman, but straddles surgery vs repeat diagnostics ─────── */
  {
    payload: {
      referralId: 'REF-2026-0178',
      receivedAt: '2026-07-20T08:05:00',
      channel: 'fax',
      patient: {
        name: 'Samplin, Vera',
        mrn: 'MRN-05036',
        dob: '1948-09-08',
        sex: 'F',
        phone: '(919) 555-0441',
      },
      referredBy: {
        provider: 'Dr. Hugh Bramblett, MD',
        npi: '1932650478',
        practice: 'Zebulon Medical Associates',
        phone: '(919) 555-0445',
        fax: '(919) 555-0446',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Chronic right hand numbness; old nerve test, result unknown. Please evaluate.',
      clinicalNote:
        'Pt c/o numbness R hand x 1+ yr, thumb through long finger, worse at night. Had an "electric shock test" at an outside facility years ago — result not available, pt cannot recall. Night splint helps a little. Please eval and advise re: surgery vs repeat testing.',
      diagnoses: [{ icd10: 'G56.01', description: 'Carpal tunnel syndrome, right upper limb' }],
      attachments: [{ title: 'Faxed referral letter', type: 'note', date: '2026-07-19', pages: 1 }],
      structured: {
        meds: ['metoprolol 25 mg BID', 'atorvastatin 10 mg daily'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.84 },
        presentationCategory: { value: 'compression', confidence: 0.8 },
        laterality: { value: 'one_side', confidence: 0.82 },
        primarySymptom: { value: 'numbness_tingling', confidence: 0.81 },
        symptomRegion: { value: 'wrist', confidence: 0.78 },
        // Pivotal: a test was done, but nobody knows what it showed.
        nerveStudyStatus: { value: 'unsure', confidence: 0.5 },
        nightOrPositional: { value: 'yes', confidence: 0.8 },
        durationBand: { value: 'chronic_gt12wk', confidence: 0.82 },
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
    annotations: {
      flags: { ambiguousBetween: ['Dr. Eliana Saltzman', 'Dr. Lisa Hobson-Webb / Dr. Vern Juel'] },
    },
  },

  /* ── 0179 · MISMATCH: referral says carpal tunnel, the story is a cervical
   *          radiculopathy → Dr. Abd-El-Barr ──────────────────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0179',
      receivedAt: '2026-07-22T14:20:00',
      channel: 'epic',
      patient: {
        name: 'Demoback, Charlene',
        mrn: 'MRN-05061',
        dob: '1975-02-19',
        sex: 'F',
        phone: '(984) 555-0452',
      },
      referredBy: {
        provider: 'Dr. Stephen Okonkwo, MD',
        npi: '1364827509',
        practice: 'Morrisville Family Medicine',
        phone: '(919) 555-0456',
        fax: '(919) 555-0457',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Carpal tunnel syndrome, right — please evaluate for carpal tunnel release.',
      clinicalNote:
        'Thanks for seeing this 51-year-old florist for presumed carpal tunnel. She describes four months of aching pain that starts at the right side of the neck, travels past the elbow, and ends in the thumb and index finger, gradually worsening and now limiting arranging work and sleep. Phalen is equivocal, and turning the head to the right reproduces the arm symptoms. No nerve studies or imaging yet — I would defer to your judgment on workup.',
      diagnoses: [
        { icd10: 'G56.01', description: 'Carpal tunnel syndrome, right upper limb' },
        { icd10: 'M54.12', description: 'Radiculopathy, cervical region' },
      ],
      attachments: [{ title: 'Office visit note', type: 'note', date: '2026-07-21', pages: 2 }],
      structured: {
        vitals: { bp: '127/79', hr: '73' },
        meds: ['naproxen 500 mg BID'],
        problems: ['Right arm pain', 'Presumed carpal tunnel syndrome'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.94 },
        presentationCategory: { value: 'compression', confidence: 0.88 },
        laterality: { value: 'one_side', confidence: 0.9 },
        primarySymptom: { value: 'pain', confidence: 0.87 },
        // The note's substance: neck-radiating, not wrist-localised.
        symptomRegion: { value: 'neck_radiating', confidence: 0.86 },
        progression: { value: 'slowly_worsening', confidence: 0.85 },
        functionalImpact: { value: 'interferes_daily', confidence: 0.88 },
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
      flags: { statedReasonMismatch: true },
    },
  },

  /* ── 0180 · MISMATCH: referral asks for pain management, the story is a
   *          focal operable neuroma → Dr. Mithani ─────────────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0180',
      receivedAt: '2026-07-21T11:15:00',
      channel: 'epic',
      patient: {
        name: 'Stubbins, Marcus',
        mrn: 'MRN-05089',
        dob: '1966-11-30',
        sex: 'M',
        phone: '(919) 555-0463',
      },
      referredBy: {
        provider: 'Dr. Yvette Duplantis, MD',
        npi: '1478561203',
        practice: 'Hillsborough Community Health',
        phone: '(984) 555-0467',
        fax: '(984) 555-0468',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Chronic nerve pain, right ankle — requesting pain management options and medication review.',
      clinicalNote:
        'Referring this 59-year-old contractor for pain management of chronic right ankle nerve pain. Two years after hardware removal at the medial ankle he has an exquisitely localized burning pain at the scar with a discrete trigger point and a Tinel that shoots into the arch. Ultrasound on 7/8 reports a focal neuroma of a tibial sensory branch at the scar. Gabapentin and duloxetine at good doses have failed. He is losing work time and wants options.',
      diagnoses: [
        { icd10: 'G57.91', description: 'Unspecified mononeuropathy of right lower limb' },
        { icd10: 'M79.671', description: 'Pain in right foot' },
      ],
      attachments: [
        { title: 'Ultrasound right ankle report', type: 'imaging', date: '2026-07-08', pages: 1 },
        { title: 'Office visit note', type: 'note', date: '2026-07-20', pages: 2 },
      ],
      structured: {
        vitals: { bp: '133/85', hr: '77', bmi: '29.8' },
        meds: ['gabapentin 900 mg TID', 'duloxetine 60 mg daily'],
        problems: ['Chronic right ankle pain', 'Hardware removal, right ankle (2024)'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.93 },
        presentationCategory: { value: 'pain_predominant', confidence: 0.9 },
        // The substance — a discrete post-surgical neuroma — is a surgical
        // target, not a medication problem.
        priorTraumaSurgery: { value: 'prior_surgery', confidence: 0.92 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        priorTraumaSurgery: 'attachment',
      },
    },
    annotations: {
      flags: { statedReasonMismatch: true },
    },
  },

  /* ── 0181 · "Routine lump" that has doubled in six weeks → expedited mass
   *          escalation (also a stated-reason mismatch) ────────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0181',
      receivedAt: '2026-07-24T08:20:00',
      channel: 'phone',
      patient: {
        name: 'Fauxberry, Nadine',
        mrn: 'MRN-05112',
        dob: '1971-05-03',
        sex: 'F',
        phone: '(919) 555-0474',
      },
      referredBy: {
        provider: 'Dr. Colin Marsh, MD',
        npi: '1596034782',
        practice: 'Pittsboro Primary Care',
        phone: '(919) 555-0478',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Routine evaluation of a small wrist lump; patient anxious, no rush per referring office.',
      clinicalNote:
        'Phone referral transcribed by intake staff: Dr. Marsh called to arrange a routine visit for a 55-year-old teacher with a lump on the volar right forearm, framed as reassurance for an anxious patient. On intake questioning, however, the patient reports the lump has roughly doubled in size over the past six weeks and she now gets electric tingling into the ring and small fingers when it is pressed. No injury. No prior imaging.',
      diagnoses: [{ icd10: 'R22.31', description: 'Localized swelling, mass and lump, right upper limb' }],
      attachments: [],
      structured: {},
    },
    extraction: {
      variables: {
        // A rapidly enlarging mass with new neuro symptoms is the tree's
        // mass_lump red flag, whatever the cover sheet says.
        urgentRedFlag: { value: 'mass_lump', confidence: 0.88 },
      },
      sources: {
        urgentRedFlag: 'referrer-stated',
      },
    },
    annotations: {
      flags: { statedReasonMismatch: true },
    },
  },

  /* ── 0182 · Foot drop developing over five days → urgent progressive
   *          fast-track escalation ─────────────────────────────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0182',
      receivedAt: '2026-07-23T17:40:00',
      channel: 'fax',
      patient: {
        name: 'Placebo-Whitfield, Earl',
        mrn: 'MRN-05147',
        dob: '1953-01-22',
        sex: 'M',
        phone: '(984) 555-0482',
      },
      referredBy: {
        provider: 'Dr. Rosa Imbach, MD',
        npi: '1287409635',
        practice: 'Siler City Family Medicine',
        phone: '(919) 555-0486',
        fax: '(919) 555-0487',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'urgent',
      reasonForReferral: 'New right foot drop progressing over 5 days; urgent evaluation requested.',
      clinicalNote:
        'Pt seen today. R foot drop developing over past 5 days, now catching toes and tripping on stairs. Dorsiflexion 2/5, eversion weak, sensation dorsum foot reduced. No back pain, no trauma, no bowel/bladder change. Urgent eval please — faxing records today.',
      diagnoses: [{ icd10: 'M21.371', description: 'Foot drop, right foot' }],
      attachments: [{ title: 'Faxed referral letter', type: 'note', date: '2026-07-23', pages: 1 }],
      structured: {
        meds: ['metformin 500 mg BID'],
      },
    },
    extraction: {
      variables: {
        // Rapidly progressive weakness / acute foot drop — the tree's 'acute'
        // red-flag value.
        urgentRedFlag: { value: 'acute', confidence: 0.86 },
      },
      sources: {
        urgentRedFlag: 'note',
      },
    },
  },

  /* ── 0183 · Genuinely unclear diffuse story → human triage (esc_ambiguous) ─ */
  {
    payload: {
      referralId: 'REF-2026-0183',
      receivedAt: '2026-07-18T12:30:00',
      channel: 'fax',
      patient: {
        name: 'Mockingale, Doris',
        mrn: 'MRN-05173',
        dob: '1946-06-30',
        sex: 'F',
        phone: '(919) 555-0491',
      },
      referredBy: {
        provider: 'Dr. Ambrose Tilley, MD',
        npi: '1650283947',
        practice: 'Louisburg Medical Clinic',
        phone: '(919) 555-0495',
        fax: '(919) 555-0496',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Diffuse arm and leg symptoms, unclear etiology. Please advise.',
      clinicalNote:
        'Pt w/ vague sx — burning in the legs some days, arm heaviness on others, poor sleep, hx difficult to pin down and wanders on retelling. Neuro exam nonfocal, labs unremarkable. Honestly unsure whether this is nerve vs rheumatologic vs deconditioning. Please advise on disposition.',
      diagnoses: [
        { icd10: 'R20.9', description: 'Unspecified disturbances of skin sensation' },
        { icd10: 'M79.609', description: 'Pain in unspecified limb' },
      ],
      attachments: [{ title: 'Faxed referral letter', type: 'note', date: '2026-07-17', pages: 2 }],
      structured: {
        meds: ['levothyroxine 50 mcg daily', 'trazodone 50 mg QHS'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.84 },
        // The fax itself cannot place the presentation — the honest value is
        // 'unclear', which the tree sends to human triage.
        presentationCategory: { value: 'unclear', confidence: 0.58 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
      },
    },
  },

  /* ── 0184 · Functional-restoration ask without any UMN event → human triage
   *          (esc_ambiguous via umnHistory 'none') ─────────────────────────── */
  {
    payload: {
      referralId: 'REF-2026-0184',
      receivedAt: '2026-07-23T09:50:00',
      channel: 'epic',
      patient: {
        name: 'Testani, Victor',
        mrn: 'MRN-05201',
        dob: '1962-04-11',
        sex: 'M',
        phone: '(984) 555-0503',
      },
      referredBy: {
        provider: 'Dr. Ingrid Solvang, MD',
        npi: '1809274653',
        practice: 'Chapel Hill Adult Medicine',
        phone: '(919) 555-0507',
        fax: '(919) 555-0508',
      },
      referredToDepartment: 'Duke Nerve Center',
      priority: 'routine',
      reasonForReferral: 'Progressive left hand stiffness and weakness; candidate for your functional-restoration program?',
      clinicalNote:
        'I wonder whether this 64-year-old draftsman might benefit from your functional-restoration program. Over about a year his left hand has become stiff and clumsy — buttons and drawing are difficult — with mild intrinsic weakness on exam. Notably he has never had a stroke, head injury, or spinal-cord injury, and there is no cerebral palsy history; MRI brain last year for unrelated headaches was normal. I confess the etiology is unclear to me, but the functional loss is real.',
      diagnoses: [{ icd10: 'M62.81', description: 'Muscle weakness (generalized)' }],
      attachments: [
        { title: 'Office visit note', type: 'note', date: '2026-07-22', pages: 2 },
        { title: 'MRI brain report (2025)', type: 'imaging', date: '2025-09-04', pages: 1 },
      ],
      structured: {
        vitals: { bp: '129/81', hr: '70' },
        meds: ['rosuvastatin 10 mg daily'],
        problems: ['Left hand weakness and stiffness, progressive'],
      },
    },
    extraction: {
      variables: {
        urgentRedFlag: { value: 'none', confidence: 0.92 },
        presentationCategory: { value: 'functional_umn', confidence: 0.82 },
        // The note is explicit: no stroke / TBI / CP / SCI — so the
        // functional-restoration pathway has no confident basis.
        umnHistory: { value: 'none', confidence: 0.9 },
      },
      sources: {
        urgentRedFlag: 'note',
        presentationCategory: 'note',
        umnHistory: 'note',
      },
    },
  },
]
