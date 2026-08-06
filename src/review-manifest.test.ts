import test from 'node:test'
import assert from 'node:assert/strict'
import type { FileDiffMetadata } from '@pierre/diffs'
import {
  normalizeReviewManifest,
  orderFilesForReview,
  getReviewManifestDiagnostics,
} from './review-manifest.js'

function file(name: string): FileDiffMetadata {
  return {
    name,
    type: 'change',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: false,
    deletionLines: [],
    additionLines: [],
  }
}

test('normalizes review manifest entries into a deterministic path map', () => {
  const manifest = normalizeReviewManifest({
    summary: 'Users can review a packet as one saved document.',
    implementation: 'Adds packet persistence, response wiring, and coverage.',
    files: [
      { path: 'src/server.ts', summary: 'Starts the packet review flow.', order: 2 },
      { path: 'src/types.ts', summary: 'Adds the packet data contract.', order: 1 },
    ],
  })

  assert.deepEqual(manifest.files.map((entry) => entry.path), [
    'src/types.ts',
    'src/server.ts',
  ])
  assert.equal(manifest.summary, 'Users can review a packet as one saved document.')
  assert.equal(manifest.implementation, 'Adds packet persistence, response wiring, and coverage.')
  assert.equal(manifest.byPath['src/types.ts']?.summary, 'Adds the packet data contract.')
})

test('accepts legacy justification-only manifests', () => {
  const manifest = normalizeReviewManifest({
    files: [{ path: 'src/server.ts', justification: 'legacy entry point' }],
  })

  assert.equal(manifest.byPath['src/server.ts']?.summary, 'legacy entry point')
  assert.equal(manifest.summary, null)
})

test('orders diff files by manifest order and appends unlisted files alphabetically', () => {
  const manifest = normalizeReviewManifest({
    files: [
      { path: 'src/server.ts', justification: 'entry point' },
      { path: 'src/types.ts', justification: 'contract' },
    ],
  })

  const ordered = orderFilesForReview(
    [file('z-unlisted.ts'), file('src/types.ts'), file('src/server.ts')],
    manifest
  )

  assert.deepEqual(ordered.map((entry) => entry.name), [
    'src/server.ts',
    'src/types.ts',
    'z-unlisted.ts',
  ])
})

test('reports files missing from the manifest and stale manifest paths', () => {
  const manifest = normalizeReviewManifest({
    files: [
      { path: 'src/server.ts', justification: 'entry point' },
      { path: 'src/stale.ts', justification: 'removed from diff' },
    ],
  })

  const diagnostics = getReviewManifestDiagnostics(
    [file('src/server.ts'), file('src/types.ts')],
    manifest
  )

  assert.deepEqual(diagnostics.filesMissingFromManifest, ['src/types.ts'])
  assert.deepEqual(diagnostics.manifestPathsMissingFromDiff, ['src/stale.ts'])
})

test('keeps well-formed sections and drops malformed ones', () => {
  const manifest = normalizeReviewManifest({
    files: [
      {
        path: 'src/server.ts',
        summary: 'entry point',
        sections: [
          { side: 'additions', startLine: 12, endLine: 15, label: 'Adds imports.' },
          { side: 'sideways', startLine: 12, endLine: 15, label: 'bad side' },
          { side: 'additions', startLine: 'nope', endLine: 15, label: 'bad line' },
          { side: 'additions', startLine: 15, endLine: 12, label: 'end before start' },
          { side: 'additions', startLine: 12, endLine: 15, label: '   ' },
        ],
      },
    ],
  })

  assert.deepEqual(manifest.byPath['src/server.ts']?.sections, [
    { side: 'additions', startLine: 12, endLine: 15, label: 'Adds imports.' },
  ])
})

test('rejects duplicate manifest paths', () => {
  assert.throws(
    () =>
      normalizeReviewManifest({
        files: [
          { path: 'src/server.ts', justification: 'first' },
          { path: 'src/server.ts', justification: 'second' },
        ],
      }),
    /duplicate review manifest path/
  )
})
