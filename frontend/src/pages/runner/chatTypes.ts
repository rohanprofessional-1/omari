/**
 * Omari — shared intake-conversation types.
 *
 * These live outside Runner.tsx so that the presentation-mode ORB view
 * (src/components/OrbExperience.tsx) and the patient-facing screens can consume
 * the conversation shape WITHOUT importing the Runner module, which also holds
 * the clinician-only "behind the scenes" panel. Runner.tsx used to export these
 * and OrbExperience imported them back out of it — a cycle that dragged the
 * whole clinician file into anything that touched the chat.
 */

/** Where the conversation is in its turn cycle. */
export type Phase = 'intro' | 'thinking' | 'awaiting' | 'done' | 'error'

/** One rendered turn in the thread. */
export interface ChatMessage {
  id: number
  from: 'bot' | 'patient'
  text: string
}
