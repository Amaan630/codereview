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

export interface ReviewStackEntry {
  id: string
  title: string
  summary: string
  files: string[]
}

export interface ReviewManifest {
  title?: string
  stack?: ReviewStackEntry[]
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
  title?: unknown
  stack?: unknown
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

  const stack: ReviewStackEntry[] = []
  const assignedPaths = new Set<string>()
  if (maybeManifest?.stack !== undefined) {
    if (!Array.isArray(maybeManifest.stack) || maybeManifest.stack.length === 0) {
      throw new Error('review stack must be a non-empty array')
    }
    for (const entry of maybeManifest.stack) {
      if (!entry || typeof entry !== 'object' ||
          typeof entry.id !== 'string' || !entry.id.trim() ||
          typeof entry.title !== 'string' || !entry.title.trim() ||
          typeof entry.summary !== 'string' || !entry.summary.trim() ||
          !Array.isArray(entry.files) || entry.files.length === 0) {
        throw new Error('each review stack entry needs an id, title, summary and files')
      }
      if (stack.some((previous) => previous.id === entry.id.trim())) {
        throw new Error(`duplicate review stack id: ${entry.id}`)
      }
      const paths: string[] = []
      for (const rawPath of entry.files) {
        const path = typeof rawPath === 'string' ? normalizePath(rawPath) : ''
        if (!byPath[path]) throw new Error(`review stack path not in manifest: ${path}`)
        if (assignedPaths.has(path)) throw new Error(`duplicate review stack path: ${path}`)
        assignedPaths.add(path)
        paths.push(path)
      }
      stack.push({ id: entry.id.trim(), title: entry.title.trim(), summary: entry.summary.trim(), files: paths })
    }
    for (const file of files) {
      if (!assignedPaths.has(file.path)) throw new Error(`file missing from review stack: ${file.path}`)
    }
  }

  files.sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
  return {
    ...(stack.length ? { stack } : {}),
    ...(typeof maybeManifest?.title === 'string' ? { title: maybeManifest.title.trim() } : {}),
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
