import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './server.js'

test('only unanswered open questions reach the reviewer, and replies stay attached', async () => {
  const app = createApp('/tmp')
  const location = { filePath: 'example.ts', side: 'additions', lineNumber: 1, lineContent: 'const value = 1' }
  const post = (path: string, body: unknown, method = 'POST') =>
    app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const queue = async () => (await app.request('/api/questions')).json()

  await post('/api/comments', { ...location, body: 'An ordinary comment' })
  const response = await post('/api/comments', { ...location, body: 'Why?', askAgent: true })
  assert.equal(response.status, 201)
  const question = await response.json()
  assert.deepEqual(await queue(), [question])

  assert.equal((await post(`/api/comments/${question.id}/replies`, { body: ' ' })).status, 400)
  assert.equal((await queue()).length, 1)
  const answered = await (await post(`/api/comments/${question.id}/replies`, { body: 'Because…' })).json()
  assert.equal(answered.replies[0].body, 'Because…')
  assert.deepEqual(await queue(), [])

  const second = await (await post('/api/comments', { ...location, body: 'Another?', askAgent: true })).json()
  await post(`/api/comments/${second.id}`, { status: 'resolved' }, 'PUT')
  assert.deepEqual(await queue(), [])
  await post(`/api/comments/${second.id}`, { status: 'open' }, 'PUT')
  assert.equal((await queue()).length, 1)
  await app.request(`/api/comments/${second.id}`, { method: 'DELETE' })
  assert.deepEqual(await queue(), [])
})

test('questions require text, a valid code location and an explicit boolean', async () => {
  const app = createApp('/tmp')
  const valid = { filePath: 'example.ts', side: 'additions', lineNumber: 1, lineContent: 'code', body: 'Why?', askAgent: true }
  for (const invalid of [{ body: '' }, { filePath: null }, { side: 'other' }, { lineNumber: 0 }, { lineContent: null }, { askAgent: 'true' }]) {
    const response = await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...valid, ...invalid }),
    })
    assert.equal(response.status, 400)
  }
  assert.deepEqual(await (await app.request('/api/questions')).json(), [])
})

test('other websites cannot submit questions to the local reviewer', async () => {
  const app = createApp('/tmp')
  const body = JSON.stringify({ filePath: 'example.ts', side: 'additions', lineNumber: 1, lineContent: 'code', body: 'Why?', askAgent: true })
  const requests: Record<string, string>[] = [{ 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/json', Origin: 'https://other.example' }]
  for (const headers of requests) {
    const response = await app.request('/api/comments', { method: 'POST', headers, body })
    assert.equal(response.status, 403)
  }
  const rebound = await app.request('http://other.example/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  assert.equal(rebound.status, 403)
})
