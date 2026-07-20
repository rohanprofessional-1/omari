import { TreeSchema, type Tree, type TreeInput } from '../types/tree'
import { VARIABLE_SPECS } from './variableSpecs'

/**
 * Blume — seeded peripheral-nerve-surgery routing tree.
 *
 * A realistic, clinically-plausible stand-in for a surgeon-authored tree so
 * the Builder isn't empty and the Runner has something to route against.
 *
 * Flow:
 *   1. Red-flag screen (presentationType): a mass/lump escalates for imaging,
 *      acute trauma routes to an URGENT specialist, "unsure" escalates, and
 *      typical nerve symptoms continue down the tree.
 *   2. Narrow by dominant symptom -> anatomical location.
 *   3. Upper limb is further triaged by EMG status, then duration; lower limb
 *      by duration; neck-radiating goes straight to plexus expertise.
 *   4. Land on a named sub-specialist (with workup + reasoning) or escalate.
 *
 * The deterministic engine evaluates a node's branches IN ORDER and follows
 * the first whose condition matches — authoring order is significant.
 */

// TreeInput: the raw literal uses the legacy flat workup arrays; TreeSchema.parse
// normalizes them into WorkupSpec ({ always, conditional, doNotOrderUnless }).
const SAMPLE_TREE_RAW: TreeInput = {
  treeId: 'blume-peripheral-nerve-v1',
  rootNodeId: 'node_presentation',
  nodes: [
    /* ----------------------------------------------------------------- */
    /* 1. Red-flag screen                                                */
    /* ----------------------------------------------------------------- */
    {
      id: 'node_presentation',
      type: 'variable',
      variableKey: 'presentationType',
      prompt:
        'Before nerve triage, screen for red flags: a mass, an acute injury, or typical nerve symptoms.',
      dataSource: 'patient',
      branches: [
        {
          label: 'A lump or mass they can feel',
          patientLabel: 'A lump or mass I can feel',
          condition: { op: 'equals', value: 'mass_lump' },
          nextNodeId: 'node_esc_mass',
        },
        {
          label: 'A recent injury or trauma',
          patientLabel: 'A recent injury or accident',
          condition: { op: 'equals', value: 'acute_trauma' },
          nextNodeId: 'node_spec_acute_trauma',
        },
        {
          label: 'Typical ongoing nerve symptoms',
          patientLabel: 'Numbness, tingling, or shooting pain',
          condition: { op: 'equals', value: 'typical_nerve_symptoms' },
          nextNodeId: 'node_dominant_symptom',
        },
        {
          label: 'Unclear / cannot be classified',
          patientLabel: "I'm not sure",
          condition: { op: 'equals', value: 'unsure' },
          nextNodeId: 'node_esc_ambiguous',
        },
      ],
    },

    /* ----------------------------------------------------------------- */
    /* 2. Dominant symptom                                               */
    /* ----------------------------------------------------------------- */
    {
      id: 'node_dominant_symptom',
      type: 'variable',
      variableKey: 'dominantSymptom',
      prompt: 'Identify the single most bothersome symptom.',
      dataSource: 'patient',
      branches: [
        {
          label: 'Mainly pain',
          patientLabel: 'Mainly pain',
          condition: { op: 'equals', value: 'pain' },
          nextNodeId: 'node_location',
        },
        {
          label: 'Mainly numbness or tingling',
          patientLabel: 'Mainly numbness or tingling',
          condition: { op: 'equals', value: 'numbness_tingling' },
          nextNodeId: 'node_location',
        },
        {
          label: 'Mainly weakness',
          patientLabel: 'Mainly weakness',
          condition: { op: 'equals', value: 'weakness' },
          nextNodeId: 'node_location',
        },
        {
          label: 'A mix of symptoms',
          patientLabel: 'A mix of things',
          condition: { op: 'equals', value: 'mixed' },
          nextNodeId: 'node_location',
        },
      ],
    },

    /* ----------------------------------------------------------------- */
    /* 3. Anatomical location (primary router)                           */
    /* ----------------------------------------------------------------- */
    {
      id: 'node_location',
      type: 'variable',
      variableKey: 'symptomLocation',
      prompt: 'Localise the symptoms to the upper limb, lower limb, or neck.',
      dataSource: 'patient',
      branches: [
        {
          label: 'Arm or hand',
          patientLabel: 'My arm or hand',
          condition: { op: 'equals', value: 'arm_hand' },
          nextNodeId: 'node_emg_upper',
        },
        {
          label: 'Leg or foot',
          patientLabel: 'My leg or foot',
          condition: { op: 'equals', value: 'leg_foot' },
          nextNodeId: 'node_duration_lower',
        },
        {
          label: 'Neck, radiating down the arm',
          patientLabel: 'My neck, and it shoots down my arm',
          condition: { op: 'equals', value: 'neck_radiating' },
          nextNodeId: 'node_spec_reyes',
        },
      ],
    },

    /* ----------------------------------------------------------------- */
    /* 3a. Upper limb: triage by EMG status                              */
    /* ----------------------------------------------------------------- */
    {
      id: 'node_emg_upper',
      type: 'variable',
      variableKey: 'emgStatus',
      prompt: 'Use existing nerve-study results to grade the upper-limb workup.',
      dataSource: 'record',
      branches: [
        {
          label: 'Nerve test done and abnormal',
          patientLabel: 'Yes, and it showed something',
          condition: { op: 'equals', value: 'done_abnormal' },
          nextNodeId: 'node_spec_chen',
        },
        {
          label: 'Nerve test done and normal',
          patientLabel: 'Yes, and it was normal',
          condition: { op: 'equals', value: 'done_normal' },
          nextNodeId: 'node_spec_patel',
        },
        {
          label: 'Nerve test not done yet',
          patientLabel: "No, I haven't had one",
          condition: { op: 'equals', value: 'not_done' },
          nextNodeId: 'node_duration_upper',
        },
      ],
    },

    /* ----------------------------------------------------------------- */
    /* 3b. Upper limb, no EMG yet: triage by duration                    */
    /* ----------------------------------------------------------------- */
    {
      id: 'node_duration_upper',
      type: 'variable',
      variableKey: 'symptomDuration',
      prompt: 'Without nerve studies, use the time course to decide next step.',
      dataSource: 'patient',
      branches: [
        {
          label: 'Chronic (months or longer)',
          patientLabel: 'Months or longer',
          condition: { op: 'equals', value: 'chronic' },
          nextNodeId: 'node_spec_chen',
        },
        {
          label: 'Subacute (weeks)',
          patientLabel: 'A few weeks',
          condition: { op: 'equals', value: 'subacute' },
          nextNodeId: 'node_spec_patel',
        },
        {
          label: 'Acute (days)',
          patientLabel: 'Just a few days',
          condition: { op: 'equals', value: 'acute' },
          nextNodeId: 'node_esc_ambiguous',
        },
      ],
    },

    /* ----------------------------------------------------------------- */
    /* 3c. Lower limb: triage by duration                                */
    /* ----------------------------------------------------------------- */
    {
      id: 'node_duration_lower',
      type: 'variable',
      variableKey: 'symptomDuration',
      prompt: 'Time course for lower-limb nerve symptoms; screen for acute red flags.',
      dataSource: 'patient',
      branches: [
        {
          label: 'Chronic (months or longer)',
          patientLabel: 'Months or longer',
          condition: { op: 'equals', value: 'chronic' },
          nextNodeId: 'node_spec_okafor',
        },
        {
          label: 'Subacute (weeks)',
          patientLabel: 'A few weeks',
          condition: { op: 'equals', value: 'subacute' },
          nextNodeId: 'node_spec_okafor',
        },
        {
          label: 'Acute (days) — possible red flag',
          patientLabel: 'Just a few days',
          condition: { op: 'equals', value: 'acute' },
          nextNodeId: 'node_esc_ambiguous',
        },
      ],
    },

    /* ----------------------------------------------------------------- */
    /* 4. Named specialist endpoints                                     */
    /* ----------------------------------------------------------------- */
    {
      id: 'node_spec_chen',
      type: 'specialist',
      specialistName: 'Dr. Chen',
      specialty: 'Carpal/Cubital Tunnel — Common Compression Neuropathy',
      urgency: 'routine',
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): {dominantSymptom} in the {symptomLocation} with {symptomDuration} duration and EMG status "{emgStatus}" fits a common upper-limb compression neuropathy (carpal or cubital tunnel).',
      workup: [
        {
          name: 'Nerve conduction studies + needle EMG, bilateral upper limbs',
          protocol:
            'Median and ulnar motor/sensory NCS with segmental ("inching") studies across the wrist and elbow; needle EMG of APB and first dorsal interosseous.',
          rationale:
            'Localises and grades the compression at the carpal vs cubital tunnel and excludes a more proximal lesion.',
        },
        {
          name: 'High-resolution nerve ultrasound (wrist & elbow)',
          protocol:
            '18+ MHz linear probe; measure median nerve cross-sectional area at the carpal tunnel inlet and ulnar nerve CSA at the cubital tunnel.',
          rationale:
            'Confirms focal nerve enlargement and detects structural causes (ganglion, anomalous muscle, ulnar subluxation).',
        },
        {
          name: 'Metabolic screen (HbA1c, TSH)',
          protocol: 'Fasting HbA1c and TSH if symptoms are bilateral or atypical.',
          rationale:
            'Diabetes and hypothyroidism predispose to and worsen compression neuropathy and affect surgical timing.',
        },
      ],
    },
    {
      id: 'node_spec_reyes',
      type: 'specialist',
      specialistName: 'Dr. Reyes',
      specialty: 'Brachial Plexus & Upper Extremity — Complex Nerve',
      urgency: 'expedited',
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): {dominantSymptom} in the {symptomLocation} ({symptomDuration}) radiating from the neck suggests a complex cervical-root or brachial-plexus problem requiring dedicated upper-extremity nerve expertise.',
      workup: [
        {
          name: 'MRI brachial plexus with contrast',
          protocol:
            '3T; coronal/sagittal STIR and T2 fat-saturated sequences plus post-gadolinium T1; thin sections through the C5–T1 roots and plexus.',
          rationale:
            'Characterises root avulsion, plexus traction injury, or a mass impinging on the plexus.',
        },
        {
          name: 'MRI cervical spine without contrast',
          protocol: 'Sagittal/axial T2; assess the C4–T1 neural foramina.',
          rationale:
            'Distinguishes cervical radiculopathy from a true plexus lesion when symptoms radiate from the neck.',
        },
        {
          name: 'Extended EMG/NCS with plexus protocol',
          protocol:
            'Motor/sensory NCS of multiple terminal nerves plus needle EMG sampling each trunk/cord myotome and the cervical paraspinals.',
          rationale:
            'Differentiates pre- from post-ganglionic injury and maps the level of the lesion.',
        },
      ],
    },
    {
      id: 'node_spec_okafor',
      type: 'specialist',
      specialistName: 'Dr. Okafor',
      specialty: 'Lumbar/Peripheral Nerve — Lower Extremity',
      urgency: 'routine',
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): {dominantSymptom} in the {symptomLocation} with {symptomDuration} duration is consistent with lower-extremity nerve entrapment or lumbosacral radiculopathy.',
      workup: [
        {
          name: 'EMG/NCS of the lower limbs',
          protocol:
            'Peroneal and tibial motor, sural sensory NCS; needle EMG of the L4–S1 myotomes and lumbar paraspinals.',
          rationale:
            'Separates a focal peripheral entrapment (e.g. peroneal nerve at the fibular head, tarsal tunnel) from lumbosacral radiculopathy.',
        },
        {
          name: 'MRI lumbar spine without contrast',
          protocol:
            'Sagittal/axial T1 and T2; evaluate the L3–S1 neural foramina and lateral recesses.',
          rationale:
            'Identifies disc herniation or foraminal stenosis causing radicular leg symptoms.',
        },
        {
          name: 'Targeted MRI / ultrasound of the affected peripheral nerve',
          protocol:
            'High-resolution imaging of the fibular head or tarsal tunnel as indicated by the exam.',
          rationale:
            'Confirms focal entrapment and excludes a mass lesion before considering decompression.',
        },
      ],
    },
    {
      id: 'node_spec_patel',
      type: 'specialist',
      specialistName: 'Dr. Patel',
      specialty: 'General Hand Surgery — Conservative-First',
      urgency: 'routine',
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): {dominantSymptom} in the {symptomLocation} with reassuring or early findings ({emgStatus}, {symptomDuration}) is best served by conservative-first general hand care.',
      workup: [
        {
          name: 'Plain radiographs of the hand/wrist',
          protocol: 'PA, oblique, and lateral views of the symptomatic hand/wrist.',
          rationale:
            'Screens for arthritis, deformity, or a bony cause of pain when nerve testing is normal.',
        },
        {
          name: 'Structured hand-therapy / splinting trial',
          protocol:
            'Night splinting and activity modification for 6 weeks with reassessment.',
          rationale:
            'Conservative-first management resolves many non-nerve and mild cases without surgery.',
        },
        {
          name: 'Targeted ultrasound of the wrist (as needed)',
          protocol: 'Focused ultrasound for tendon or joint pathology if mechanical.',
          rationale:
            'Evaluates tendinopathy or a ganglion when symptoms are mechanical rather than neurologic.',
        },
      ],
    },
    {
      id: 'node_spec_acute_trauma',
      type: 'specialist',
      specialistName: 'Dr. Reyes',
      specialty: 'Brachial Plexus & Upper Extremity — Acute Nerve Trauma',
      urgency: 'urgent',
      reasoningTemplate:
        'Expedited routing to {specialistName} ({specialty}): an acute traumatic presentation ({presentationType}) needs urgent assessment for nerve injury and a time-sensitive repair window.',
      workup: [
        {
          name: 'Plain radiographs of the injured region',
          protocol: 'AP/lateral of the affected limb, including the joint above and below.',
          rationale:
            'Identifies fracture, dislocation, or a retained foreign body associated with the acute nerve injury.',
        },
        {
          name: 'Urgent high-resolution nerve ultrasound',
          protocol:
            'Scan the nerve along the zone of injury for transection versus an in-continuity lesion.',
          rationale:
            'Rapid triage of nerve discontinuity that may warrant early surgical exploration.',
        },
        {
          name: 'Baseline EMG/NCS (time-sensitive)',
          protocol:
            'Schedule at ~3 weeks post-injury; an earlier study can be falsely normal before Wallerian degeneration.',
          rationale:
            'Establishes a baseline to track reinnervation and to define the window for nerve repair or grafting.',
        },
      ],
    },

    /* ----------------------------------------------------------------- */
    /* 5. Escalation endpoints                                           */
    /* ----------------------------------------------------------------- */
    {
      id: 'node_esc_mass',
      type: 'escalation',
      reason:
        'Patient reports a lump or mass along the nerve. This may represent a nerve sheath tumour or other soft-tissue mass and needs expedited MRI plus multidisciplinary review before any automated routing.',
    },
    {
      id: 'node_esc_ambiguous',
      type: 'escalation',
      reason:
        'Presentation is ambiguous or shows acute features that fall outside the standard routing logic (e.g. rapidly progressive or acute lower-limb weakness/numbness raising a cauda-equina concern). Route to a human triage coordinator for manual review.',
    },
  ],
}

/**
 * Validate against the Zod schema at import time. A malformed tree throws
 * here, the moment the module is loaded — fail loud, fail early.
 */
export const sampleTree: Tree = TreeSchema.parse(SAMPLE_TREE_RAW)

/* -------------------------------------------------------------------------- */
/* Integrity cross-checks                                                     */
/* -------------------------------------------------------------------------- */
/* Zod proves the SHAPE is valid; these prove the tree is internally          */
/* consistent — no dangling edges and every variable has a spec.              */

;(function assertTreeIntegrity(tree: Tree): void {
  const ids = new Set(tree.nodes.map((n) => n.id))

  if (ids.size !== tree.nodes.length) {
    throw new Error('sampleTree integrity: duplicate node id detected.')
  }
  if (!ids.has(tree.rootNodeId)) {
    throw new Error(
      `sampleTree integrity: rootNodeId "${tree.rootNodeId}" is not a node in the tree.`,
    )
  }

  for (const node of tree.nodes) {
    if (node.type !== 'variable') continue

    if (!VARIABLE_SPECS[node.variableKey]) {
      throw new Error(
        `sampleTree integrity: node "${node.id}" references variableKey "${node.variableKey}" with no VariableSpec.`,
      )
    }
    for (const branch of node.branches) {
      if (!ids.has(branch.nextNodeId)) {
        throw new Error(
          `sampleTree integrity: node "${node.id}" branch "${branch.label}" points to missing node "${branch.nextNodeId}".`,
        )
      }
    }
  }
})(sampleTree)
