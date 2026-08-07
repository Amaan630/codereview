import { parsePatchFiles } from '@pierre/diffs'
import type { Hunk } from '@pierre/diffs'
import type { ReviewFileSection, ReviewManifest } from './review-manifest.js'

export interface ChangeBlock {
  side: 'additions' | 'deletions'
  startLine: number
  endLine: number
}

/** Every contiguous +/- run in a hunk, with real file line numbers (not diff-relative indexes). */
export function changeBlocksForHunk(hunk: Hunk): ChangeBlock[] {
  const blocks: ChangeBlock[] = []
  for (const content of hunk.hunkContent) {
    if (content.type !== 'change') continue
    if (content.additions > 0) {
      const startLine = hunk.additionStart + (content.additionLineIndex - hunk.additionLineIndex)
      blocks.push({ side: 'additions', startLine, endLine: startLine + content.additions - 1 })
    }
    if (content.deletions > 0) {
      const startLine = hunk.deletionStart + (content.deletionLineIndex - hunk.deletionLineIndex)
      blocks.push({ side: 'deletions', startLine, endLine: startLine + content.deletions - 1 })
    }
  }
  return blocks
}

interface Range {
  start: number
  end: number
}

/** Merge overlapping/adjacent ranges so several small sections can jointly cover one big block. */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Range[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

function isCovered(block: ChangeBlock, mergedRangesBySide: Record<'additions' | 'deletions', Range[]>): boolean {
  return mergedRangesBySide[block.side].some(
    (range) => range.start <= block.startLine && range.end >= block.endLine
  )
}

export interface ReviewPlanCheckResult {
  ok: boolean
  problems: string[]
}

/**
 * Deterministic gate for a review plan: every file in the diff must be in the
 * manifest, every manifest path must still exist in the diff, and every real
 * +/- change block in every file must be covered by a `sections` entry.
 */
export function checkReviewPlan(patch: string, manifest: ReviewManifest): ReviewPlanCheckResult {
  const problems: string[] = []
  const files = parsePatchFiles(patch).flatMap((p) => p.files)
  const diffPaths = new Set(files.map((file) => file.name))
  const manifestPaths = new Set(manifest.files.map((file) => file.path))

  for (const path of diffPaths) {
    if (!manifestPaths.has(path)) problems.push(`missing from review.json: ${path}`)
  }
  for (const path of manifestPaths) {
    if (!diffPaths.has(path)) problems.push(`stale in review.json (not in diff): ${path}`)
  }

  for (const file of files) {
    const entry = manifest.byPath[file.name]
    if (!entry) continue // already reported above
    const toRange = (s: ReviewFileSection): Range => ({ start: s.startLine, end: s.endLine })
    const mergedRangesBySide: Record<'additions' | 'deletions', Range[]> = {
      additions: mergeRanges(entry.sections.filter((s) => s.side === 'additions').map(toRange)),
      deletions: mergeRanges(entry.sections.filter((s) => s.side === 'deletions').map(toRange)),
    }
    for (const hunk of file.hunks) {
      for (const block of changeBlocksForHunk(hunk)) {
        if (!isCovered(block, mergedRangesBySide)) {
          problems.push(`${file.name}: no section covers ${block.side} lines ${block.startLine}-${block.endLine}`)
        }
      }
    }
  }

  return { ok: problems.length === 0, problems }
}
