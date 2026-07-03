import { TreeSchema, type Tree, type TreeInput } from '../types/tree'
import { VARIABLE_SPECS } from './variableSpecs'

/**
 * Blume — Duke Nerve Center routing tree (deep, clinically-grounded).
 *
 * A much deeper companion to the simple sample tree, modeling the real Duke
 * Nerve Center: an up-front urgent red-flag fast-track, a deep multi-specialty
 * decision tree (peripheral-nerve/hand surgery vs spine neurosurgery vs
 * neuromuscular neurology vs pain vs hand therapy), and ambiguous cross-cutting
 * cases that escalate to human triage with the full intake packet.
 *
 * DATA ONLY. It conforms to the existing Zod schema and runs through the exact
 * same engine + Runner as the simple tree — no engine/orchestrator/UI logic is
 * changed by this file.
 *
 * Architecture note (how the fast-track works WITHOUT touching the engine):
 * the root `urgentRedFlag` screen emits the engine's existing emergency VALUE
 * strings ('acute_trauma' | 'mass_lump' | 'acute') for genuine red flags, which
 * the unchanged escalation classifier already treats as EMERGENCY → it
 * short-circuits intake. Every non-urgent variable uses DISTINCT value strings,
 * so non-urgent presentations proceed through the full core intake before the
 * deterministic engine makes the routing/escalation decision.
 *
 * Specialist mappings + rationales are the researched Duke focus areas; each
 * carries `clinicalBasis` and `confirmWithDrLi: true` because the exact internal
 * referral conventions should be confirmed with Dr. Li.
 */

// TreeInput: the raw literal uses the legacy flat workup arrays; TreeSchema.parse
// normalizes them into WorkupSpec ({ always, conditional, doNotOrderUnless }).
const DUKE_TREE_RAW: TreeInput = {
  treeId: 'duke-nerve-center-v1',
  rootNodeId: 'node_redflag',
  nodes: [
    /* ================================================================== */
    /* 0. URGENT RED-FLAG FAST-TRACK (checked FIRST, bypasses intake)      */
    /* ================================================================== */
    {
      id: 'node_redflag',
      type: 'variable',
      variableKey: 'urgentRedFlag',
      prompt:
        'Up-front urgent-access screen (<72h SLA). Emergency values match the engine emergency set so they short-circuit before full intake.',
      dataSource: 'patient',
      branches: [
        { label: 'Acute traumatic nerve injury / laceration / acute plexus', patientLabel: 'A recent serious injury or cut to the area', condition: { op: 'equals', value: 'acute_trauma' }, nextNodeId: 'esc_urgent_trauma' },
        { label: 'Rapidly growing / suspicious mass', patientLabel: "A lump that's growing quickly", condition: { op: 'equals', value: 'mass_lump' }, nextNodeId: 'esc_expedited_mass' },
        { label: 'Rapidly progressive weakness / acute foot-or-wrist drop', patientLabel: "Weakness that's quickly getting worse", condition: { op: 'equals', value: 'acute' }, nextNodeId: 'esc_urgent_progressive' },
        { label: 'No red flag — proceed to full intake', patientLabel: 'None of these', condition: { op: 'equals', value: 'none' }, nextNodeId: 'node_presentation' },
      ],
    },

    /* ================================================================== */
    /* 1. Non-urgent overall category (top of the deep decision tree)      */
    /* ================================================================== */
    {
      id: 'node_presentation',
      type: 'variable',
      variableKey: 'presentationCategory',
      prompt: 'Non-urgent category that steers the deep routing.',
      dataSource: 'patient',
      branches: [
        { label: 'Compression / entrapment picture', patientLabel: 'Numbness, tingling, or pins-and-needles', condition: { op: 'equals', value: 'compression' }, nextNodeId: 'node_distribution' },
        { label: 'Older (non-acute) traumatic injury / prior surgery', patientLabel: 'An older injury or a past surgery', condition: { op: 'equals', value: 'traumatic_chronic' }, nextNodeId: 'node_trauma_region' },
        { label: 'Stable mass / lump', patientLabel: "A lump or bump that isn't changing", condition: { op: 'equals', value: 'mass_stable' }, nextNodeId: 'node_mass_eval' },
        { label: 'Pain-predominant, target unclear', patientLabel: "Pain is the main problem, but I'm not sure where it's coming from", condition: { op: 'equals', value: 'pain_predominant' }, nextNodeId: 'node_pain_prior' },
        { label: 'Functional loss after stroke/TBI/CP/SCI', patientLabel: 'Weakness or lost function after a stroke or brain/spinal injury', condition: { op: 'equals', value: 'functional_umn' }, nextNodeId: 'node_umn' },
        { label: 'Genuinely unclear', patientLabel: "I'm really not sure", condition: { op: 'equals', value: 'unclear' }, nextNodeId: 'esc_ambiguous' },
      ],
    },

    /* ---- Compression path -------------------------------------------- */
    {
      id: 'node_comp_symptom',
      type: 'variable',
      variableKey: 'primarySymptom',
      prompt: 'Dominant symptom; muscle wasting flags advanced denervation.',
      dataSource: 'patient',
      branches: [
        { label: 'Visible muscle wasting → diagnostics', patientLabel: "A muscle that looks like it's shrinking", condition: { op: 'equals', value: 'muscle_wasting' }, nextNodeId: 'spec_neuromuscular' },
        { label: 'Pain', patientLabel: 'Mostly pain', condition: { op: 'equals', value: 'pain' }, nextNodeId: 'node_comp_region' },
        { label: 'Numbness / tingling', patientLabel: 'Mostly numbness or tingling', condition: { op: 'equals', value: 'numbness_tingling' }, nextNodeId: 'node_comp_region' },
        { label: 'Weakness', patientLabel: 'Mostly weakness', condition: { op: 'equals', value: 'weakness' }, nextNodeId: 'node_comp_region' },
        { label: 'Mixed', patientLabel: 'A mix of things', condition: { op: 'equals', value: 'mixed' }, nextNodeId: 'node_comp_region' },
      ],
    },
    {
      id: 'node_distribution',
      type: 'variable',
      variableKey: 'laterality',
      prompt: 'One side vs both; bilateral raises suspicion for a systemic process.',
      dataSource: 'patient',
      branches: [
        { label: 'Both sides → systemic workup', patientLabel: 'Both sides', condition: { op: 'equals', value: 'both_sides' }, nextNodeId: 'spec_neuromuscular' },
        { label: 'One side', patientLabel: 'Just one side', condition: { op: 'equals', value: 'one_side' }, nextNodeId: 'node_comp_symptom' },
      ],
    },
    {
      id: 'node_comp_region',
      type: 'variable',
      variableKey: 'symptomRegion',
      prompt: 'Detailed anatomy → upper-vs-lower and spine-vs-peripheral routing.',
      dataSource: 'patient',
      branches: [
        { label: 'Neck, radiating down the arm → spine', patientLabel: 'My neck, and it shoots down my arm', condition: { op: 'equals', value: 'neck_radiating' }, nextNodeId: 'node_spine' },
        { label: 'Shoulder / upper arm → localize', patientLabel: 'My shoulder or upper arm', condition: { op: 'equals', value: 'shoulder_upper_arm' }, nextNodeId: 'spec_neuromuscular' },
        { label: 'Elbow', patientLabel: 'My elbow', condition: { op: 'equals', value: 'elbow' }, nextNodeId: 'node_comp_emg_upper' },
        { label: 'Forearm', patientLabel: 'My forearm', condition: { op: 'equals', value: 'forearm' }, nextNodeId: 'node_comp_emg_upper' },
        { label: 'Wrist', patientLabel: 'My wrist', condition: { op: 'equals', value: 'wrist' }, nextNodeId: 'node_comp_emg_upper' },
        { label: 'Hand / fingers', patientLabel: 'My hand or fingers', condition: { op: 'equals', value: 'hand_fingers' }, nextNodeId: 'node_comp_emg_upper' },
        { label: 'Hip / thigh', patientLabel: 'My hip or thigh', condition: { op: 'equals', value: 'hip_thigh' }, nextNodeId: 'node_comp_lower' },
        { label: 'Knee', patientLabel: 'My knee', condition: { op: 'equals', value: 'knee' }, nextNodeId: 'node_comp_lower' },
        { label: 'Lower leg', patientLabel: 'My lower leg', condition: { op: 'equals', value: 'lower_leg' }, nextNodeId: 'node_comp_lower' },
        { label: 'Ankle / foot', patientLabel: 'My ankle or foot', condition: { op: 'equals', value: 'ankle_foot' }, nextNodeId: 'node_comp_lower' },
        { label: 'Multifocal → systemic workup', patientLabel: 'Spread across several areas', condition: { op: 'equals', value: 'multifocal' }, nextNodeId: 'spec_neuromuscular' },
      ],
    },
    {
      id: 'node_comp_emg_upper',
      type: 'variable',
      variableKey: 'nerveStudyStatus',
      prompt: 'Upper-limb compression: gate surgical vs diagnostic on EMG result.',
      dataSource: 'record',
      branches: [
        { label: 'EMG abnormal → surgical eval', patientLabel: 'Yes, and it showed something', condition: { op: 'equals', value: 'done_abnormal' }, nextNodeId: 'spec_saltzman' },
        { label: 'EMG normal', patientLabel: 'Yes, and it was normal', condition: { op: 'equals', value: 'done_normal' }, nextNodeId: 'node_comp_night' },
        { label: 'Not done', patientLabel: "No, I haven't had one", condition: { op: 'equals', value: 'not_done' }, nextNodeId: 'node_comp_night' },
        { label: 'Unsure', patientLabel: "I had one but I'm not sure of the result", condition: { op: 'equals', value: 'unsure' }, nextNodeId: 'node_comp_night' },
      ],
    },
    {
      id: 'node_comp_night',
      type: 'variable',
      variableKey: 'nightOrPositional',
      prompt: 'Night/positional symptoms = classic compression pattern.',
      dataSource: 'patient',
      branches: [
        { label: 'Yes → classic compression', patientLabel: 'Yes', condition: { op: 'equals', value: 'yes' }, nextNodeId: 'node_comp_duration' },
        { label: 'No → atypical, needs diagnostics', patientLabel: 'No', condition: { op: 'equals', value: 'no' }, nextNodeId: 'spec_neuromuscular' },
      ],
    },
    {
      id: 'node_comp_duration',
      type: 'variable',
      variableKey: 'durationBand',
      prompt: 'Conservative-vs-surgical timing per the 6–12 week referral guidance.',
      dataSource: 'patient',
      branches: [
        { label: 'Chronic (>12wk) → surgical eval', patientLabel: 'More than three months', condition: { op: 'equals', value: 'chronic_gt12wk' }, nextNodeId: 'spec_saltzman' },
        { label: 'Approaching 6–12wk → surgical eval', patientLabel: 'Around two to three months', condition: { op: 'equals', value: 'approaching_6_12wk' }, nextNodeId: 'spec_saltzman' },
        { label: 'Subacute (2–6wk) → conservative first', patientLabel: 'A few weeks', condition: { op: 'equals', value: 'subacute_2_6wk' }, nextNodeId: 'spec_handtherapy' },
        { label: 'Acute (<2wk) → conservative first', patientLabel: 'Less than two weeks', condition: { op: 'equals', value: 'acute_lt2wk' }, nextNodeId: 'spec_handtherapy' },
      ],
    },
    {
      id: 'node_comp_lower',
      type: 'variable',
      variableKey: 'nerveStudyStatus',
      prompt: 'Lower-limb compression: surgical reconstruction vs diagnostics.',
      dataSource: 'record',
      branches: [
        { label: 'EMG abnormal → reconstruction', patientLabel: 'Yes, and it showed something', condition: { op: 'equals', value: 'done_abnormal' }, nextNodeId: 'spec_mithani' },
        { label: 'EMG normal → diagnostics', patientLabel: 'Yes, and it was normal', condition: { op: 'equals', value: 'done_normal' }, nextNodeId: 'spec_neuromuscular' },
        { label: 'Not done → diagnostics first', patientLabel: "No, I haven't had one", condition: { op: 'equals', value: 'not_done' }, nextNodeId: 'spec_neuromuscular' },
        { label: 'Unsure → diagnostics first', patientLabel: "I had one but I'm not sure of the result", condition: { op: 'equals', value: 'unsure' }, nextNodeId: 'spec_neuromuscular' },
      ],
    },

    /* ---- Spine (neurosurgery) path ----------------------------------- */
    {
      id: 'node_spine',
      type: 'variable',
      variableKey: 'progression',
      prompt: 'Cervical radicular pattern → neurosurgery; triage by trajectory.',
      dataSource: 'patient',
      branches: [
        { label: 'Rapidly worsening → complex/trauma spine', patientLabel: 'Quickly getting worse', condition: { op: 'equals', value: 'rapidly_worsening' }, nextNodeId: 'spec_bhowmick' },
        { label: 'Slowly worsening', patientLabel: 'Slowly getting worse', condition: { op: 'equals', value: 'slowly_worsening' }, nextNodeId: 'node_spine_op' },
        { label: 'Stable → non-operative', patientLabel: 'Staying about the same', condition: { op: 'equals', value: 'stable' }, nextNodeId: 'spec_smith' },
      ],
    },
    {
      id: 'node_spine_op',
      type: 'variable',
      variableKey: 'functionalImpact',
      prompt: 'Progressive radiculopathy: surgical candidacy by functional loss.',
      dataSource: 'patient',
      branches: [
        { label: 'Severe loss → complex spine', patientLabel: 'A severe loss of use', condition: { op: 'equals', value: 'severe_loss' }, nextNodeId: 'spec_bhowmick' },
        { label: 'Interferes daily → MIS spine', patientLabel: 'It interferes with daily life', condition: { op: 'equals', value: 'interferes_daily' }, nextNodeId: 'spec_abd_el_barr' },
        { label: 'Mild → non-operative first', patientLabel: 'Mild and manageable', condition: { op: 'equals', value: 'mild' }, nextNodeId: 'spec_smith' },
      ],
    },

    /* ---- Chronic/old trauma reconstruction path ---------------------- */
    {
      id: 'node_trauma_region',
      type: 'variable',
      variableKey: 'symptomRegion',
      prompt: 'Non-acute traumatic injury → reconstruction; plexus vs limb.',
      dataSource: 'patient',
      branches: [
        { label: 'Neck-radiating → brachial plexus', patientLabel: 'My neck, and it shoots down my arm', condition: { op: 'equals', value: 'neck_radiating' }, nextNodeId: 'spec_li' },
        { label: 'Shoulder / upper arm → brachial plexus', patientLabel: 'My shoulder or upper arm', condition: { op: 'equals', value: 'shoulder_upper_arm' }, nextNodeId: 'spec_li' },
        { label: 'Elbow → nerve reconstruction', patientLabel: 'My elbow', condition: { op: 'equals', value: 'elbow' }, nextNodeId: 'spec_mithani' },
        { label: 'Forearm → nerve reconstruction', patientLabel: 'My forearm', condition: { op: 'equals', value: 'forearm' }, nextNodeId: 'spec_mithani' },
        { label: 'Wrist → nerve reconstruction', patientLabel: 'My wrist', condition: { op: 'equals', value: 'wrist' }, nextNodeId: 'spec_mithani' },
        { label: 'Hand / fingers → nerve reconstruction', patientLabel: 'My hand or fingers', condition: { op: 'equals', value: 'hand_fingers' }, nextNodeId: 'spec_mithani' },
        { label: 'Hip / thigh → nerve reconstruction', patientLabel: 'My hip or thigh', condition: { op: 'equals', value: 'hip_thigh' }, nextNodeId: 'spec_mithani' },
        { label: 'Knee → nerve reconstruction', patientLabel: 'My knee', condition: { op: 'equals', value: 'knee' }, nextNodeId: 'spec_mithani' },
        { label: 'Lower leg → nerve reconstruction', patientLabel: 'My lower leg', condition: { op: 'equals', value: 'lower_leg' }, nextNodeId: 'spec_mithani' },
        { label: 'Ankle / foot → nerve reconstruction', patientLabel: 'My ankle or foot', condition: { op: 'equals', value: 'ankle_foot' }, nextNodeId: 'spec_mithani' },
        { label: 'Multifocal → human triage', patientLabel: 'Spread across several areas', condition: { op: 'equals', value: 'multifocal' }, nextNodeId: 'esc_ambiguous' },
      ],
    },

    /* ---- Stable mass path -------------------------------------------- */
    {
      id: 'node_mass_eval',
      type: 'variable',
      variableKey: 'nerveStudyStatus',
      prompt: 'Stable mass: characterize before deciding surgery.',
      dataSource: 'record',
      branches: [
        { label: 'EMG abnormal (nerve involved) → reconstruction', patientLabel: 'Yes, and it showed something', condition: { op: 'equals', value: 'done_abnormal' }, nextNodeId: 'spec_mithani' },
        { label: 'EMG normal → ultrasound/imaging first', patientLabel: 'Yes, and it was normal', condition: { op: 'equals', value: 'done_normal' }, nextNodeId: 'spec_neuromuscular' },
        { label: 'Not done → ultrasound/imaging first', patientLabel: "No, I haven't had one", condition: { op: 'equals', value: 'not_done' }, nextNodeId: 'spec_neuromuscular' },
        { label: 'Unsure → ultrasound/imaging first', patientLabel: "I had one but I'm not sure of the result", condition: { op: 'equals', value: 'unsure' }, nextNodeId: 'spec_neuromuscular' },
      ],
    },

    /* ---- Pain-predominant path --------------------------------------- */
    {
      id: 'node_pain_prior',
      type: 'variable',
      variableKey: 'priorTraumaSurgery',
      prompt: 'Pain-predominant: post-surgical/neuroma vs other.',
      dataSource: 'patient',
      branches: [
        { label: 'Prior surgery / amputation → neuroma/TMR surgery', patientLabel: 'A past surgery or amputation', condition: { op: 'equals', value: 'prior_surgery' }, nextNodeId: 'spec_mithani' },
        { label: 'Prior injury → post-traumatic nerve pain surgery', patientLabel: 'A past injury', condition: { op: 'equals', value: 'recent_injury' }, nextNodeId: 'spec_mithani' },
        { label: 'None', patientLabel: 'Neither', condition: { op: 'equals', value: 'none' }, nextNodeId: 'node_pain_systemic' },
      ],
    },
    {
      id: 'node_pain_systemic',
      type: 'variable',
      variableKey: 'systemicContext',
      prompt: 'Pain without surgical target: systemic context routes to neuromuscular.',
      dataSource: 'patient',
      branches: [
        { label: 'Diabetes → neuromuscular neurology', patientLabel: 'Diabetes', condition: { op: 'equals', value: 'diabetes' }, nextNodeId: 'spec_neuromuscular' },
        { label: 'Autoimmune / systemic → neuromuscular neurology', patientLabel: 'An autoimmune or other ongoing condition', condition: { op: 'equals', value: 'autoimmune_systemic' }, nextNodeId: 'spec_neuromuscular' },
        { label: 'None → pain medicine', patientLabel: 'Neither', condition: { op: 'equals', value: 'none' }, nextNodeId: 'spec_vorenkamp' },
      ],
    },

    /* ---- Functional restoration (UMN) path --------------------------- */
    {
      id: 'node_umn',
      type: 'variable',
      variableKey: 'umnHistory',
      prompt: 'Functional loss after an upper-motor-neuron event → restoration surgery.',
      dataSource: 'patient',
      branches: [
        { label: 'Stroke → functional restoration', patientLabel: 'A stroke', condition: { op: 'equals', value: 'stroke' }, nextNodeId: 'spec_li' },
        { label: 'TBI → functional restoration', patientLabel: 'A brain injury', condition: { op: 'equals', value: 'tbi' }, nextNodeId: 'spec_li' },
        { label: 'Cerebral palsy → functional restoration', patientLabel: 'Cerebral palsy', condition: { op: 'equals', value: 'cerebral_palsy' }, nextNodeId: 'spec_li' },
        { label: 'Spinal cord injury → functional restoration', patientLabel: 'A spinal-cord injury', condition: { op: 'equals', value: 'spinal_cord_injury' }, nextNodeId: 'spec_li' },
        { label: 'No UMN history → human triage', patientLabel: 'None of these', condition: { op: 'equals', value: 'none' }, nextNodeId: 'esc_ambiguous' },
      ],
    },

    /* ================================================================== */
    /* DESTINATIONS — surgical peripheral nerve / hand                     */
    /* ================================================================== */
    {
      id: 'spec_li',
      type: 'specialist',
      specialistName: 'Dr. Neill Li',
      specialty: 'Orthopaedic Surgery — Hand/Upper-Extremity & Peripheral Nerve (Director)',
      urgency: 'expedited',
      clinicalBasis:
        'Brachial plexus (adult + birth), nerve transfers, AND upper-motor-neuron functional restoration after stroke/TBI/CP/SCI (nerve + tendon + muscle transfer). Route here for brachial plexus injuries, complex peripheral-nerve reconstruction, functional restoration after UMN injury, and upper-limb nerve-transfer candidates.',
      confirmWithDrLi: true,
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): a {presentationCategory} presentation in the {symptomRegion} fits brachial-plexus / nerve-transfer or upper-motor-neuron functional-restoration expertise.',
      workup: [
        { name: 'MRI brachial plexus with contrast', protocol: '3T; coronal/sagittal STIR + T2 fat-sat and post-gadolinium T1 through C5–T1.', rationale: 'Characterises root avulsion, plexus traction injury, or a mass on the plexus.' },
        { name: 'Extended EMG/NCS (plexus protocol)', protocol: 'Multi-nerve motor/sensory NCS plus needle EMG of each trunk/cord myotome and cervical paraspinals.', rationale: 'Differentiates pre- vs post-ganglionic injury and maps the lesion level / reinnervation potential.' },
        { name: 'Bring prior imaging, operative notes, and EMG reports', protocol: 'Patient/referrer to forward outside records before the visit.', rationale: 'Reconstruction and transfer planning depend on prior studies and the injury timeline.' },
      ],
    },
    {
      id: 'spec_saltzman',
      type: 'specialist',
      specialistName: 'Dr. Eliana Saltzman',
      specialty: 'Orthopaedic Surgery — Hand/Upper-Extremity & Peripheral Nerve',
      urgency: 'routine',
      clinicalBasis:
        'Hand/upper-extremity nerve, plus arthritis, sports injuries, and fractures. Route here for common compression neuropathies (carpal tunnel, cubital tunnel) and general hand/upper-extremity nerve complaints; conservative-appropriate upper-limb cases.',
      confirmWithDrLi: true,
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): an upper-limb compression pattern in the {symptomRegion} (nerve study "{nerveStudyStatus}", {durationBand}) fits a common compression neuropathy for surgical evaluation.',
      workup: [
        { name: 'Nerve conduction studies + needle EMG (upper limbs)', protocol: 'Median/ulnar motor/sensory NCS with segmental "inching" across the wrist and elbow; needle EMG of APB and first dorsal interosseous.', rationale: 'Localises and grades carpal vs cubital tunnel and excludes a more proximal lesion.' },
        { name: 'High-resolution nerve ultrasound (wrist & elbow)', protocol: '18+ MHz probe; median CSA at the carpal tunnel inlet, ulnar CSA at the cubital tunnel.', rationale: 'Confirms focal nerve enlargement and detects structural causes.' },
      ],
    },
    {
      id: 'spec_mithani',
      type: 'specialist',
      specialistName: 'Dr. Suhail Mithani',
      specialty: 'Plastic Surgery & Hand — Nerve / Soft-Tissue Reconstruction',
      urgency: 'expedited',
      clinicalBasis:
        'TMR, neuroma/amputation-pain surgery, soft-tissue + nerve reconstruction anywhere on the body, and dysvascular hands. Route here for post-amputation/neuroma pain, traumatic soft-tissue + nerve reconstruction, and lower-OR-upper extremity nerve reconstruction beyond the hand.',
      confirmWithDrLi: true,
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): a {presentationCategory} picture in the {symptomRegion} (prior history "{priorTraumaSurgery}") fits nerve/soft-tissue reconstruction, neuroma, or TMR surgery.',
      workup: [
        { name: 'High-resolution nerve ultrasound and/or targeted MRI of the region', protocol: 'Image the nerve along the zone of injury / suspected neuroma.', rationale: 'Defines continuity, neuroma, or a soft-tissue lesion before reconstruction planning.' },
        { name: 'EMG/NCS of the affected limb', protocol: 'Motor/sensory NCS + needle EMG of the relevant myotomes.', rationale: 'Establishes baseline nerve function and reinnervation potential.' },
        { name: 'Bring operative records and prior imaging', protocol: 'Forward outside records before the visit.', rationale: 'Reconstruction/TMR planning depends on the prior surgery and injury details.' },
      ],
    },

    /* ---- Neurosurgery (spine) ---------------------------------------- */
    {
      id: 'spec_abd_el_barr',
      type: 'specialist',
      specialistName: 'Dr. Muhammad Abd-El-Barr',
      specialty: 'Neurosurgery — Minimally Invasive / Endoscopic / Robotic Spine',
      urgency: 'routine',
      clinicalBasis:
        'Spinal stenosis, herniated disc, myelopathy, radiculopathy. Route here for neck/back-radiating symptoms suggesting a SPINE / nerve-root origin (cervical/lumbar radiculopathy) rather than a peripheral nerve.',
      confirmWithDrLi: true,
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): neck-radiating symptoms ({progression}, {functionalImpact}) point to a cervical nerve-root / spine origin suitable for minimally invasive spine evaluation.',
      workup: [
        { name: 'MRI cervical (± lumbar) spine without contrast', protocol: 'Sagittal/axial T2; assess the C4–T1 (and L3–S1 if indicated) neural foramina and recesses.', rationale: 'Identifies disc herniation or foraminal stenosis causing radicular symptoms.' },
        { name: 'Standing radiographs of the symptomatic spine', protocol: 'AP/lateral; flexion–extension if instability is suspected.', rationale: 'Assesses alignment and dynamic instability for surgical planning.' },
      ],
    },
    {
      id: 'spec_bhowmick',
      type: 'specialist',
      specialistName: 'Dr. Deb Bhowmick',
      specialty: 'Neurosurgery — Complex & Trauma Spine, Craniocervical, Deformity',
      urgency: 'expedited',
      clinicalBasis:
        'Complex & trauma spine, craniocervical junction, and cervical deformity. Route here for complex/severe or trauma-related spine pathology and craniocervical/cervical deformity.',
      confirmWithDrLi: true,
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): a {progression} cervical radicular picture with {functionalImpact} suggests complex/severe spine pathology for sub-specialised review.',
      workup: [
        { name: 'MRI + CT of the cervical spine', protocol: 'MRI for cord/root compression; CT for bony detail and deformity.', rationale: 'Complex/deformity planning needs both soft-tissue and bony imaging.' },
        { name: 'Standing + flexion–extension radiographs', protocol: 'Full-length alignment and dynamic views.', rationale: 'Evaluates deformity and instability before complex reconstruction.' },
      ],
    },
    {
      id: 'spec_smith',
      type: 'specialist',
      specialistName: 'Dr. Gabriel Smith',
      specialty: 'Neurosurgery — Holistic Non-Operative Nerve Injury & Pain',
      urgency: 'routine',
      clinicalBasis:
        'Holistic NON-OPERATIVE care for nerve injury and pain. Route here for nerve-injury / pain patients who are not surgical candidates or want a non-operative-first pathway.',
      confirmWithDrLi: true,
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): a {progression}, {functionalImpact} picture is well suited to a non-operative-first nerve-injury and pain pathway.',
      workup: [
        { name: 'MRI of the symptomatic region', protocol: 'Targeted imaging of the cervical spine or affected segment.', rationale: 'Confirms there is no lesion mandating surgery before a non-operative plan.' },
        { name: 'Structured non-operative plan (therapy ± medication)', protocol: 'Document current treatments and response to date.', rationale: 'Builds a tailored conservative plan and a clear re-referral threshold.' },
      ],
    },

    /* ---- Neuromuscular neurology (diagnostics-first) ----------------- */
    {
      id: 'spec_neuromuscular',
      type: 'specialist',
      specialistName: 'Dr. Lisa Hobson-Webb / Dr. Vern Juel',
      specialty: 'Neuromuscular Neurology — EMG & Nerve/Muscle Ultrasound',
      urgency: 'routine',
      clinicalBasis:
        'EMG + nerve/muscle ULTRASOUND experts. Route here when a diagnostic nerve study/EMG is needed before any surgical decision; for diffuse/multifocal/bilateral symptoms; for suspected systemic, diabetic, inflammatory, or autoimmune neuropathy; or when it is unclear whether the problem is peripheral vs systemic. (Team also includes Karissa Gable, Natalia Gonzalez; Wuwei Feng for stroke; Natalie Katz for pediatrics.)',
      confirmWithDrLi: true,
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): a {laterality}/{systemicContext} or diagnostically-unclear picture needs EMG and nerve/muscle ultrasound to characterise before any surgical decision.',
      workup: [
        { name: 'EMG / nerve conduction studies', protocol: 'Tailored motor/sensory NCS + needle EMG of the symptomatic and screening myotomes.', rationale: 'Establishes whether the process is focal, multifocal, or a generalized neuropathy.' },
        { name: 'High-resolution nerve & muscle ultrasound', protocol: 'Targeted and screening ultrasound of the relevant nerves/muscles.', rationale: 'Adds structural detail and helps separate peripheral from systemic causes.' },
        { name: 'Labs (HbA1c, autoimmune/inflammatory panel as indicated)', protocol: 'Fasting HbA1c; ESR/CRP and autoimmune serologies when a systemic cause is suspected.', rationale: 'Screens for diabetic and inflammatory/autoimmune neuropathy.' },
      ],
    },

    /* ---- Pain / supportive ------------------------------------------- */
    {
      id: 'spec_vorenkamp',
      type: 'specialist',
      specialistName: 'Dr. Kevin Vorenkamp',
      specialty: 'Anesthesiology — Pain Medicine',
      urgency: 'routine',
      clinicalBasis:
        'Pain-predominant chronic nerve pain where the surgical target is unclear, and pain co-management. Route here for chronic neuropathic pain without a clear surgical target.',
      confirmWithDrLi: true,
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): a pain-predominant picture without a clear surgical target or systemic driver is best served by pain-medicine co-management.',
      workup: [
        { name: 'Medication & treatment review', protocol: 'Bring a current medication list and prior pain treatments.', rationale: 'Informs a neuropathic-pain regimen and avoids duplicating trials.' },
        { name: 'Consider a diagnostic nerve block', protocol: 'Image-guided block of the suspected nerve where appropriate.', rationale: 'Confirms the pain generator and can be therapeutic.' },
      ],
    },
    {
      id: 'spec_handtherapy',
      type: 'specialist',
      specialistName: 'Hand Therapy / Occupational Therapy',
      specialty: 'Conservative-First Rehab (Espinoza, Hallenen, Khelfa)',
      urgency: 'routine',
      clinicalBasis:
        'Conservative-first management, splinting/therapy trials, and pre/post-operative rehabilitation. Route here for early/mild compression and conservative-appropriate cases before surgical referral.',
      confirmWithDrLi: true,
      reasoningTemplate:
        'Routing to {specialistName} ({specialty}): an early ({durationBand}) compression pattern is appropriate for a conservative splinting/therapy trial first, with a clear re-referral threshold.',
      workup: [
        { name: 'Night splinting + activity modification trial', protocol: 'Neutral-wrist night splint and ergonomic changes for ~6 weeks, then reassess.', rationale: 'Resolves many mild/early compression cases without surgery.' },
        { name: 'Hand-therapy / ergonomic assessment', protocol: 'Therapist evaluation with a home program.', rationale: 'Optimises conservative management and documents response for re-referral.' },
      ],
    },

    /* ================================================================== */
    /* ESCALATIONS                                                         */
    /* ================================================================== */
    {
      id: 'esc_urgent_trauma',
      type: 'escalation',
      reason:
        'URGENT FAST-TRACK (<72h): acute traumatic nerve injury — laceration/avulsion/stretch/crush, an open wound with motor/sensory loss, a suspected nerve laceration with a surgical wound, or an acute brachial plexus injury (adult trauma or birth injury). Route immediately to peripheral-nerve / brachial-plexus surgery (Dr. Li / Dr. Mithani) within the center’s 72-hour urgent-access window; do not delay for full intake.',
    },
    {
      id: 'esc_expedited_mass',
      type: 'escalation',
      reason:
        'EXPEDITED: a rapidly growing or suspicious mass/lump along a nerve may be a nerve-sheath or soft-tissue tumour. Expedite imaging (MRI + high-resolution nerve ultrasound) and multidisciplinary tumour review before any automated routing.',
    },
    {
      id: 'esc_urgent_progressive',
      type: 'escalation',
      reason:
        'URGENT FAST-TRACK: rapidly progressive weakness, acute foot drop / wrist drop, or cauda-equina-type signals (sudden bowel/bladder change with leg weakness/numbness). Needs urgent in-person evaluation; escalate immediately rather than completing the questionnaire.',
    },
    {
      id: 'esc_ambiguous',
      type: 'escalation',
      reason:
        'Cross-cutting or ambiguous presentation that does not cleanly fit a single pathway (e.g. could be spine vs peripheral nerve, multifocal trauma, or functional loss without a clear upper-motor-neuron history). Per the center’s explicitly multidisciplinary model, route to the human triage coordinator WITH the full collected intake packet rather than forcing an automated guess.',
    },
  ],
}

/**
 * Validate against the Zod schema at import — a malformed tree fails loudly the
 * moment the module loads.
 */
export const dukeNerveTree: Tree = TreeSchema.parse(DUKE_TREE_RAW)

/* -------------------------------------------------------------------------- */
/* Integrity cross-checks (same discipline as the sample tree)                */
/* -------------------------------------------------------------------------- */

;(function assertTreeIntegrity(tree: Tree): void {
  const ids = new Set(tree.nodes.map((n) => n.id))

  if (ids.size !== tree.nodes.length) {
    throw new Error('dukeNerveTree integrity: duplicate node id detected.')
  }
  if (!ids.has(tree.rootNodeId)) {
    throw new Error(`dukeNerveTree integrity: rootNodeId "${tree.rootNodeId}" is not a node.`)
  }

  for (const node of tree.nodes) {
    if (node.type !== 'variable') continue
    if (!VARIABLE_SPECS[node.variableKey]) {
      throw new Error(
        `dukeNerveTree integrity: node "${node.id}" references variableKey "${node.variableKey}" with no VariableSpec.`,
      )
    }
    for (const branch of node.branches) {
      if (!ids.has(branch.nextNodeId)) {
        throw new Error(
          `dukeNerveTree integrity: node "${node.id}" branch "${branch.label}" points to missing node "${branch.nextNodeId}".`,
        )
      }
    }
  }
})(dukeNerveTree)
