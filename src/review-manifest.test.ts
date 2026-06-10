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
    files: [
      { path: 'src/server.ts', justification: 'entry point', order: 2 },
      { path: 'src/types.ts', justification: 'contract', order: 1 },
    ],
  })

  assert.deepEqual(manifest.files.map((entry) => entry.path), [
    'src/types.ts',
    'src/server.ts',
  ])
  assert.equal(manifest.byPath['src/types.ts']?.justification, 'contract')
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
