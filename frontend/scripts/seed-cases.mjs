/**
 * Blume — seed hand-authored synthetic cases for the tree generator.
 *
 * Eight clinically-plausible peripheral-nerve referral narratives with
 * ground-truth variables planted (conceptual-spec R1: case quality is the
 * hidden bottleneck — these are curated, not generated). Idempotent-ish:
 * skips seeding if cases for the subspecialty already exist.
 *
 * Usage: node scripts/seed-cases.mjs   (FastAPI must be up on :8000)
 */

const API = process.env.API_BASE || 'http://localhost:8000/api/v1'
const SUBSPECIALTY = 'Peripheral nerve surgery'

const CASES = [
  {
    narrative:
      "58-year-old right-handed accountant referred by his PCP. For about 8 months he's had numbness and tingling in the right thumb, index and middle fingers — worse at night, shakes his hand to 'wake it up.' Dropping coffee cups lately. Wears a wrist splint from the pharmacy that helps a little. No neck pain, no radiating pain from the shoulder. An EMG done last month at an outside lab was read as moderate median neuropathy at the wrist. Past history: well-controlled type 2 diabetes. No masses or skin changes. He's frustrated it's affecting his typing.",
    ground_truth: {
      symptom_location: 'hand_wrist',
      dominant_symptom: 'numbness_tingling',
      symptom_duration_months: 8,
      emg_status: 'done_abnormal',
      mass_present: false,
      trauma_recent: false,
    },
  },
  {
    narrative:
      "34-year-old landscaper, left-handed, referred after a fall from a ladder 3 weeks ago onto his left shoulder. Since the injury he cannot lift the left arm above shoulder height and describes deep burning pain from the neck into the upper arm, with patchy numbness over the deltoid and forearm. Grip is weak. ER x-rays showed no fracture. No EMG yet — his PCP wanted the specialist to decide timing. He is otherwise healthy, very anxious about returning to work.",
    ground_truth: {
      symptom_location: 'shoulder_arm',
      dominant_symptom: 'weakness',
      symptom_duration_months: 1,
      emg_status: 'not_done',
      mass_present: false,
      trauma_recent: true,
    },
  },
  {
    narrative:
      "61-year-old retired teacher referred for a slowly enlarging, slightly tender lump on the inner aspect of the right forearm, first noticed about a year ago. Over the last 3 months she's developed tingling into the ring and little fingers when the lump is pressed, and some cramping in the hand. No weight loss, no fevers, no trauma. No prior imaging of the arm. Important detail from her cardiology record: she has a pacemaker placed 2019 for sick sinus syndrome. No EMG yet.",
    ground_truth: {
      symptom_location: 'forearm',
      dominant_symptom: 'mass_with_symptoms',
      symptom_duration_months: 12,
      emg_status: 'not_done',
      mass_present: true,
      has_pacemaker: true,
      trauma_recent: false,
    },
  },
  {
    narrative:
      "45-year-old marathon runner with 10 months of burning pain and numbness on the sole of the left foot, worse after long runs and at night. She describes it as 'walking on a rolled-up sock.' Tapping behind the inner ankle reproduces the tingling. Calf strength normal, no back pain, no radiation from the hip. Outside EMG two months ago showed tibial neuropathy at the ankle (tarsal tunnel). Tried orthotics and NSAIDs with partial relief. No masses. Healthy otherwise.",
    ground_truth: {
      symptom_location: 'foot_ankle',
      dominant_symptom: 'numbness_tingling',
      symptom_duration_months: 10,
      emg_status: 'done_abnormal',
      mass_present: false,
      trauma_recent: false,
    },
  },
  {
    narrative:
      "27-year-old graduate student referred for 5 months of progressive right foot drop — he now catches his toes on stairs and has rolled the ankle twice. Numbness over the top of the foot and outer shin. He crosses his legs constantly while studying, and symptoms began after a long hospitalization for pneumonia where he lost 12 kg. No back pain, no bowel or bladder symptoms. EMG last week: peroneal neuropathy at the fibular head, active denervation. No masses.",
    ground_truth: {
      symptom_location: 'leg_foot',
      dominant_symptom: 'weakness',
      symptom_duration_months: 5,
      emg_status: 'done_abnormal',
      mass_present: false,
      trauma_recent: false,
    },
  },
  {
    narrative:
      "52-year-old warehouse supervisor referred with 6 weeks of neck pain radiating down the right arm to the thumb, with tingling that worsens when he looks up or reaches overhead. Some nights the whole arm 'goes dead.' Reflexes at the biceps are reduced per the referring note. He had a cervical MRI ordered by his PCP showing a C6 disc protrusion. No EMG. No hand clumsiness, no gait trouble. He asks specifically whether this is 'a neck problem or a nerve problem.'",
    ground_truth: {
      symptom_location: 'neck_radiating',
      dominant_symptom: 'radiating_pain',
      symptom_duration_months: 2,
      emg_status: 'not_done',
      mass_present: false,
      trauma_recent: false,
    },
  },
  {
    narrative:
      "70-year-old retired electrician with 14 months of numbness in BOTH hands and, more recently, both feet — 'like wearing gloves and socks all the time.' Occasional burning at night. He's stumbled twice in the dark. Longstanding poorly-controlled diabetes (A1c 9.2), moderate alcohol use. No neck or back pain, no weakness on exam per the referral, no masses. No EMG yet. The referring PCP wonders about carpal tunnel but notes the symmetric feet involvement.",
    ground_truth: {
      symptom_location: 'bilateral_hands_feet',
      dominant_symptom: 'numbness_tingling',
      symptom_duration_months: 14,
      emg_status: 'not_done',
      mass_present: false,
      trauma_recent: false,
    },
  },
  {
    narrative:
      "39-year-old dental hygienist referred with 7 months of aching and tingling in the left hand, mainly ring and little fingers, worse when leaning on her elbow at work and when holding a phone. Occasional weakness pinching instruments. Symptoms improve on vacation. An EMG done last month was read as NORMAL. No neck pain, no masses, no trauma. She is worried because her mother had 'nerve surgery that didn't work.'",
    ground_truth: {
      symptom_location: 'hand_wrist',
      dominant_symptom: 'numbness_tingling',
      symptom_duration_months: 7,
      emg_status: 'done_normal',
      mass_present: false,
      trauma_recent: false,
    },
  },
]

async function main() {
  const existing = await fetch(
    `${API}/gen/cases?subspecialty=${encodeURIComponent(SUBSPECIALTY)}`,
  ).then((r) => r.json())
  if (Array.isArray(existing) && existing.length > 0) {
    console.log(`[seed-cases] ${existing.length} cases already exist for "${SUBSPECIALTY}" — skipping.`)
    return
  }
  for (const c of CASES) {
    const res = await fetch(`${API}/gen/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subspecialty: SUBSPECIALTY,
        narrative: c.narrative,
        ground_truth: c.ground_truth,
        source: 'hand_authored',
      }),
    })
    if (!res.ok) throw new Error(`seed failed (${res.status}): ${await res.text()}`)
    const row = await res.json()
    console.log(`[seed-cases] ✓ ${row.id.slice(0, 8)} · ${c.narrative.slice(0, 60)}…`)
  }
  console.log(`[seed-cases] done — ${CASES.length} cases seeded for "${SUBSPECIALTY}".`)
}

main().catch((err) => {
  console.error('[seed-cases] FAILED:', err.message)
  process.exitCode = 1
})
