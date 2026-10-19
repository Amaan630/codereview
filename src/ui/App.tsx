import { useMemo, useCallback, useRef, useState, useEffect, useLayoutEffect } from 'react'
import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ReviewComment } from '../types'
import { useDiff } from './hooks/useDiff'
import { useComments } from './hooks/useComments'
import { useSettings } from './hooks/useSettings'
import { useViewed } from './hooks/useViewed'
import { Toolbar } from './components/Toolbar'
import { DiffViewer } from './components/DiffViewer'
import {
  getReviewManifestDiagnostics,
  orderFilesForReview,
} from '../review-manifest'

export function App() {
  const { settings, loaded, updateSettings } = useSettings()
  const { patch, repoName, branch, customMode, binaryFiles, tabSizeMap, reviewManifest, loading, error } = useDiff({
    staged: settings.staged,
    untracked: settings.untracked,
  })
  const { comments, addComment, removeComment, copyAllComments } =
    useComments()
  const [selectedEntry, setSelectedEntry] = useState(() => window.location.hash.slice(1))
  const pendingScroll = useRef<{ from: string; to: string } | null>(null)
  useEffect(() => {
    const updateEntry = () => setSelectedEntry(window.location.hash.slice(1))
    window.addEventListener('hashchange', updateEntry)
    return () => window.removeEventListener('hashchange', updateEntry)
  }, [])
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [selectedEntry])

  const files = useMemo(() => {
    if (!patch) return []
    try {
      const parsed = parsePatchFiles(patch)
      const parsedFiles = parsed.flatMap((p) => p.files)

      // Add synthetic entries for binary files not already in parsed output
      const existingNames = new Set(parsedFiles.map((f) => f.name))
      for (const bf of binaryFiles) {
        if (!existingNames.has(bf.path)) {
          const syntheticFile: FileDiffMetadata = {
            name: bf.path,
            type: bf.type === 'added' || bf.type === 'untracked' ? 'new' : bf.type === 'deleted' ? 'deleted' : 'change',
            hunks: [],
            splitLineCount: 0,
            unifiedLineCount: 0,
            isPartial: true,
            deletionLines: [],
            additionLines: [],
          }
          parsedFiles.push(syntheticFile)
        }
      }

      return orderFilesForReview(parsedFiles, reviewManifest)
    } catch {
      return []
    }
  }, [patch, binaryFiles, reviewManifest])

  const reviewManifestDiagnostics = useMemo(() => {
    return getReviewManifestDiagnostics(files, reviewManifest)
  }, [files, reviewManifest])

  const reviewMetadataByPath = useMemo(() => {
    return reviewManifest?.byPath ?? {}
  }, [reviewManifest])

  const activeEntry = reviewManifest?.stack?.find((entry) => entry.id === selectedEntry)
    ?? reviewManifest?.stack?.[0]
  const visibleFiles = useMemo(() => {
    if (!activeEntry) return files
    const byPath = new Map(files.map((file) => [file.name, file]))
    return activeEntry.files.flatMap((path) => {
      const file = byPath.get(path)
      return file ? [file] : []
    })
  }, [files, activeEntry])
  const { viewedFiles, setViewed } = useViewed(files)

  const diffStats = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const file of visibleFiles) {
      for (const hunk of file.hunks) {
        for (const content of hunk.hunkContent) {
          if (content.type === 'change') {
            additions += content.additions
            deletions += content.deletions
          }
        }
      }
    }
    return { additions, deletions }
  }, [visibleFiles])

  const binaryFileMap = useMemo(() => {
    const map = new Map<string, (typeof binaryFiles)[number]>()
    for (const bf of binaryFiles) {
      map.set(bf.path, bf)
    }
    return map
  }, [binaryFiles])

  const fileAnnotationsMap = useMemo(() => {
    const map = new Map<string, { side: ReviewComment['side']; lineNumber: number; metadata: ReviewComment }[]>()
    for (const c of comments) {
      let list = map.get(c.filePath)
      if (!list) {
        list = []
        map.set(c.filePath, list)
      }
      list.push({
        side: c.side,
        lineNumber: c.lineNumber,
        metadata: c,
      })
    }
    return map
  }, [comments])

  const scrollToFile = useCallback((filePath: string) => {
    const el = document.getElementById(`file-${filePath}`)
    if (el) {
      el.scrollIntoView({ block: 'start' })
    }
  }, [])

  const handleViewedChange = useCallback((filePath: string, viewed: boolean) => {
    setViewed(filePath, viewed)
    if (!viewed) return

    const currentFileIndex = visibleFiles.findIndex((file) => file.name === filePath)
    const nextUnviewedFile = visibleFiles
      .slice(currentFileIndex + 1)
      .find((file) => !viewedFiles.has(file.name))
    if (nextUnviewedFile) {
      pendingScroll.current = { from: filePath, to: nextUnviewedFile.name }
    }
  }, [visibleFiles, setViewed, viewedFiles])

  useLayoutEffect(() => {
    const target = pendingScroll.current
    if (!target || !viewedFiles.has(target.from)) return
    pendingScroll.current = null
    scrollToFile(target.to)
  }, [viewedFiles, scrollToFile])

  if (!loaded || loading) {
    return (
      <div className="loading">
        <p>Loading diff...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error">
        <p>Error: {error}</p>
      </div>
    )
  }

  return (
    <div className={activeEntry ? 'app app-with-stack' : 'app'}>
      {reviewManifest?.stack && (
        <aside className="stack-sidebar">
          <h1 className="toolbar-title">{reviewManifest.title ?? 'Review stack'}</h1>
          <nav aria-label="Review stack">
            {reviewManifest.stack.map((entry, index) => (
              <a key={entry.id} href={`#${entry.id}`} aria-current={entry === activeEntry ? 'page' : undefined}>
                <span className="stack-number">{String(index + 1).padStart(2, '0')}</span>
                <span>{entry.title}<small>{entry.files.length} file{entry.files.length === 1 ? '' : 's'} · {entry.files.filter((path) => viewedFiles.has(path)).length} viewed</small></span>
              </a>
            ))}
          </nav>
        </aside>
      )}
      <Toolbar
        repoName={repoName}
        branch={branch}
        fileCount={visibleFiles.length}
        additions={diffStats.additions}
        deletions={diffStats.deletions}
        commentCount={comments.length}
        diffStyle={settings.diffStyle}
        diffOptions={{ staged: settings.staged, untracked: settings.untracked }}
        defaultTabSize={settings.defaultTabSize}
        browser={settings.browser}
        customMode={customMode}
        onDiffStyleChange={(style) => updateSettings({ diffStyle: style })}
        onDiffOptionsChange={(options) => updateSettings(options)}
        onDefaultTabSizeChange={(size) => updateSettings({ defaultTabSize: size })}
        onBrowserChange={(browser) => updateSettings({ browser })}
        onCopyComments={copyAllComments}
      />
      <main className="main">
        <DiffViewer
          files={visibleFiles}
          stackEntry={activeEntry}
          diffStyle={settings.diffStyle}
          tabSizeMap={tabSizeMap}
          defaultTabSize={settings.defaultTabSize}
          viewedFiles={viewedFiles}
          binaryFiles={binaryFileMap}
          reviewManifest={reviewManifest}
          reviewMetadataByPath={reviewMetadataByPath}
          reviewManifestDiagnostics={reviewManifestDiagnostics}
          onViewedChange={handleViewedChange}
          fileAnnotationsMap={fileAnnotationsMap}
          onAddComment={addComment}
          onDeleteComment={removeComment}
        />
      </main>
    </div>
  )
}
