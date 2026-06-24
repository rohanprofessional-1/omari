"""
API Client for Blume.
This module abstracts all HTTP calls to the FastAPI backend.
"""

const API_BASE = '/api/v1'

export async function fetchTrees() {
  const res = await fetch(`${API_BASE}/trees`)
  if (!res.ok) throw new Error('Failed to fetch trees')
  return res.json()
}

export async function fetchTree(id: string) {
  const res = await fetch(`${API_BASE}/trees/${id}`)
  if (!res.ok) throw new Error('Failed to fetch tree')
  return res.json()
}

export async function fetchVariables() {
  const res = await fetch(`${API_BASE}/variables`)
  if (!res.ok) throw new Error('Failed to fetch variables')
  return res.json()
}

export async function fetchSpecialists() {
  const res = await fetch(`${API_BASE}/specialists`)
  if (!res.ok) throw new Error('Failed to fetch specialists')
  return res.json()
}

export async function startConversation(treeId: string, patientId?: string) {
  const body = patientId ? { tree_id: treeId, patient_id: patientId } : { tree_id: treeId }
  const res = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error('Failed to start conversation')
  return res.json()
}

export async function sendChatMessage(conversationId: string, message: string) {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to send chat message: ${text}`)
  }
  return res.json()
}

export async function getConversation(conversationId: string) {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}`)
  if (!res.ok) throw new Error('Failed to fetch conversation')
  return res.json()
}
