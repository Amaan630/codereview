import test from 'node:test'
import assert from 'node:assert/strict'
import { checkReviewPlan } from './check-review-plan.js'
import { normalizeReviewManifest } from './review-manifest.js'

const PATCH = `diff --git a/foo.txt b/foo.txt
index 0000000..1111111 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,3 +1,4 @@
 line1
-line2
+line2-changed
+line2b
 line3
`

test('flags every uncovered change block with its real file line numbers', () => {
  const manifest = normalizeReviewManifest({
    files: [{ path: 'foo.txt', summary: 'changes foo', sections: [] }],
  })

  const result = checkReviewPlan(PATCH, manifest)

  assert.equal(result.ok, false)
  assert.deepEqual(result.problems, [
    'foo.txt: no section covers additions lines 2-3',
    'foo.txt: no section covers deletions lines 2-2',
  ])
})

test('passes once sections cover every change block', () => {
  const manifest = normalizeReviewManifest({
    files: [
      {
        path: 'foo.txt',
        summary: 'changes foo',
        sections: [
          { side: 'deletions', startLine: 2, endLine: 2, label: 'removes line2' },
          { side: 'additions', startLine: 2, endLine: 3, label: 'adds line2-changed and line2b' },
        ],
      },
    ],
  })

  const result = checkReviewPlan(PATCH, manifest)

  assert.deepEqual(result.problems, [])
  assert.equal(result.ok, true)
})

test('lets several adjacent sections jointly cover one big change block', () => {
  const manifest = normalizeReviewManifest({
    files: [
      {
        path: 'foo.txt',
        summary: 'changes foo',
        sections: [
          { side: 'deletions', startLine: 2, endLine: 2, label: 'removes line2' },
          { side: 'additions', startLine: 2, endLine: 2, label: 'adds line2-changed' },
          { side: 'additions', startLine: 3, endLine: 3, label: 'adds line2b' },
        ],
      },
    ],
  })

  const result = checkReviewPlan(PATCH, manifest)

  assert.deepEqual(result.problems, [])
  assert.equal(result.ok, true)
})

test('flags files missing from the manifest and manifest paths no longer in the diff', () => {
  const manifest = normalizeReviewManifest({
    files: [{ path: 'stale.txt', summary: 'no longer in the diff' }],
  })

  const result = checkReviewPlan(PATCH, manifest)

  assert.equal(result.ok, false)
  assert.ok(result.problems.includes('missing from review.json: foo.txt'))
  assert.ok(result.problems.includes('stale in review.json (not in diff): stale.txt'))
})
