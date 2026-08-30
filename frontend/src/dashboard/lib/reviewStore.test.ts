import assert from 'node:assert'
import { applyAction, hydrateReviews, hydrateAudit, getSnapshot } from './reviewStore'
import type { ReviewState, AuditEvent } from '../types'

declare const process: { exitCode?: number } | undefined

// Mock fetch to prevent network requests during tests
;(global as any).fetch = async () => ({
  ok: true,
  json: async () => ({}),
})

function fail(msg: string) {
  console.error(`[reviewStore.test.ts] FAIL: ${msg}`)
  if (typeof process !== 'undefined') process.exitCode = 1
}

function testApplyActionUpdatesState() {
  // Reset state
  hydrateReviews([])
  hydrateAudit([])

  // Seed initial review state
  const initialReview: ReviewState = {
    referralId: 'REF-123',
    status: 'pending'
  }
  hydrateReviews([initialReview])

  const initialSnapshot = getSnapshot()
  assert.strictEqual(initialSnapshot.reviews['REF-123'].status, 'pending')
  assert.strictEqual(initialSnapshot.audit.length, 0)

  // Apply action
  applyAction('REF-123', 'info_requested', {
    actor: 'Dr. Test',
    role: 'surgeon',
    note: 'Needs more info'
  })

  const newSnapshot = getSnapshot()
  
  // Verify review state was updated
  if (newSnapshot.reviews['REF-123'].status !== 'info_requested') {
    fail(`Expected status to be info_requested, got ${newSnapshot.reviews['REF-123'].status}`)
  }

  // Verify audit event was created
  if (newSnapshot.audit.length !== 1) {
    fail(`Expected 1 audit event, got ${newSnapshot.audit.length}`)
  }
  
  const event = newSnapshot.audit[0]
  if (event.action !== 'info_requested') fail('Audit event action mismatch')
  if (event.note !== 'Needs more info') fail('Audit event note mismatch')
  if (event.actor !== 'Dr. Test') fail('Audit event actor mismatch')
}

function testApprovalActionAddsReviewTimestamp() {
  hydrateReviews([])
  hydrateAudit([])

  applyAction('REF-APPROVED', 'approved', {
    actor: 'Dr. Neill Li',
    role: 'surgeon',
    note: 'Approved for consultation',
  })

  const snapshot = getSnapshot()
  const review = snapshot.reviews['REF-APPROVED']
  if (review?.status !== 'approved') {
    fail(`Expected approved status, got ${review?.status}`)
  }
  if (!review?.reviewedAt) {
    fail('Expected approved review to include a reviewedAt timestamp')
  }

  const latestEvent = snapshot.audit.at(-1)
  if (!latestEvent) {
    fail('Expected an audit event after approval')
  }
  if (latestEvent.action !== 'approved') {
    fail(`Expected latest audit action to be approved, got ${latestEvent.action}`)
  }
  if (latestEvent.note !== 'Approved for consultation') {
    fail(`Expected approval note to be preserved, got ${latestEvent.note}`)
  }
}

function runAll() {
  try {
    testApplyActionUpdatesState()
    testApprovalActionAddsReviewTimestamp()
    console.log('[reviewStore.test.ts] PASS')
  } catch (err: any) {
    fail(err.message)
  }
}

runAll()
