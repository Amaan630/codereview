import type { FileDiffMetadata } from '@pierre/diffs'

export interface ReviewFileSection {
  side: 'additions' | 'deletions'
  startLine: number
  endLine: number
  label: string
}

export interface ReviewFileMetadata {
  path: string
  summary: string
  /** @deprecated Read legacy manifests through `summary` instead. */
  justification: string
  order: number
  /** Optional bordered, click-to-reveal overlays drawn around a line range. */
  sections: ReviewFileSection[]
}

export interface ReviewManifest {
  summary: string | null
  implementation: string | null
  files: ReviewFileMetadata[]
  byPath: Record<string, ReviewFileMetadata>
}

export interface ReviewManifestDiagnostics {
  filesMissingFromManifest: string[]
  manifestPathsMissingFromDiff: string[]
}

interface RawReviewFileMetadata {
  path?: unknown
  summary?: unknown
  justification?: unknown
  order?: unknown
  sections?: unknown
}

interface RawReviewManifest {
  summary?: unknown
  implementation?: unknown
  files?: unknown
}

function assertRawReviewFile(value: unknown, index: number): RawReviewFileMetadata {
  if (!value || typeof value !== 'object') {
    throw new Error(`review manifest entry ${index} must be an object`)
  }
  return value as RawReviewFileMetadata
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\.?\//, '')
}

function normalizeSections(raw: unknown): ReviewFileSection[] {
  if (!Array.isArray(raw)) return []
  const sections: ReviewFileSection[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { side, startLine, endLine, label } = entry as Record<string, unknown>
    if (side !== 'additions' && side !== 'deletions') continue
    if (typeof startLine !== 'number' || !Number.isFinite(startLine)) continue
    if (typeof endLine !== 'number' || !Number.isFinite(endLine)) continue
    if (endLine < startLine) continue
    if (typeof label !== 'string' || !label.trim()) continue
    sections.push({ side, startLine, endLine, label: label.trim() })
  }
  return sections
}

export function normalizeReviewManifest(raw: unknown): ReviewManifest {
  const maybeManifest = raw as RawReviewManifest
  const rawFiles = Array.isArray(raw)
    ? raw
    : Array.isArray(maybeManifest?.files)
      ? maybeManifest.files
      : null

  if (!rawFiles) {
    throw new Error('review manifest must be an array or an object with a files array')
  }

  const byPath: Record<string, ReviewFileMetadata> = {}
  const files = rawFiles.map((rawFile, index) => {
    const entry = assertRawReviewFile(rawFile, index)
    if (typeof entry.path !== 'string' || !entry.path.trim()) {
      throw new Error(`review manifest entry ${index} must include a non-empty path`)
    }
    const summary = entry.summary ?? entry.justification
    if (typeof summary !== 'string' || !summary.trim()) {
      throw new Error(`review manifest entry ${index} must include a non-empty summary`)
    }
    const path = normalizePath(entry.path)
    if (byPath[path]) {
      throw new Error(`duplicate review manifest path: ${path}`)
    }
    const order = typeof entry.order === 'number' && Number.isFinite(entry.order)
      ? entry.order
      : index + 1
    const normalized = {
      path,
      summary: summary.trim(),
      justification: summary.trim(),
      order,
      sections: normalizeSections(entry.sections),
    }
    byPath[path] = normalized
    return normalized
  })

  files.sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
  return {
    summary: typeof maybeManifest?.summary === 'string' && maybeManifest.summary.trim()
      ? maybeManifest.summary.trim()
      : null,
    implementation: typeof maybeManifest?.implementation === 'string' && maybeManifest.implementation.trim()
      ? maybeManifest.implementation.trim()
      : null,
    files,
    byPath,
  }
}

export function orderFilesForReview<T extends { name: string }>(
  files: T[],
  manifest: ReviewManifest | null
): T[] {
  if (!manifest) return files
  return [...files].sort((a, b) => {
    const aEntry = manifest.byPath[a.name]
    const bEntry = manifest.byPath[b.name]
    if (aEntry && bEntry) return aEntry.order - bEntry.order || a.name.localeCompare(b.name)
    if (aEntry) return -1
    if (bEntry) return 1
    return a.name.localeCompare(b.name)
  })
}

export function getReviewManifestDiagnostics(
  files: Pick<FileDiffMetadata, 'name'>[],
  manifest: ReviewManifest | null
): ReviewManifestDiagnostics {
  if (!manifest) {
    return { filesMissingFromManifest: [], manifestPathsMissingFromDiff: [] }
  }

  const diffPaths = new Set(files.map((file) => file.name))
  const manifestPaths = new Set(manifest.files.map((file) => file.path))
  return {
    filesMissingFromManifest: files
      .map((file) => file.name)
      .filter((path) => !manifestPaths.has(path))
      .sort(),
    manifestPathsMissingFromDiff: manifest.files
      .map((file) => file.path)
      .filter((path) => !diffPaths.has(path)),
  }
}
