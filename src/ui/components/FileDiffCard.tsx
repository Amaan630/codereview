import { useState, useRef, memo } from 'react'
import { FileDiff } from '@pierre/diffs/react'
import type { DiffLineAnnotation, FileDiffMetadata, AnnotationSide } from '@pierre/diffs'
import { ChevronDown, Copy } from 'lucide-react'
import type { ReviewComment } from '../../types'
import type { ReviewFileMetadata } from '../../review-manifest'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'
import { SectionOverlays } from './SectionOverlays'

interface PendingComment {
  side: AnnotationSide
  lineNumber: number
}

interface FileDiffCardProps {
  id?: string
  fileDiff: FileDiffMetadata
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
  diffStyle: 'split' | 'unified'
  tabSize: number
  viewed: boolean
  order: number
  reviewMetadata?: ReviewFileMetadata
  onViewedChange: (filePath: string, viewed: boolean) => void
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string, askAgent?: boolean) => Promise<void>
  onDeleteComment: (id: string) => void
}

export const FileDiffCard = memo(function FileDiffCard({
  id,
  fileDiff,
  filePath,
  annotations,
  diffStyle,
  tabSize,
  viewed,
  order,
  reviewMetadata,
  onViewedChange,
  onAddComment,
  onDeleteComment,
}: FileDiffCardProps) {
  const [pending, setPending] = useState<PendingComment | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const diffBodyRef = useRef<HTMLDivElement>(null)
  const separatorIndex = filePath.lastIndexOf('/')
  const fileName = separatorIndex === -1 ? filePath : filePath.slice(separatorIndex + 1)
  const directory = separatorIndex === -1 ? '' : filePath.slice(0, separatorIndex)
  const additions = fileDiff.hunks.reduce((total, hunk) => total + hunk.additionCount, 0)
  const deletions = fileDiff.hunks.reduce((total, hunk) => total + hunk.deletionCount, 0)
  const summary = reviewMetadata?.summary ?? reviewMetadata?.justification ?? `Review ${fileName}`

  const getLineContent = (side: AnnotationSide, lineNumber: number): string => {
    const lines = side === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines
    const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
    const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
    const indexKey = side === 'additions' ? 'additionLineIndex' : 'deletionLineIndex'
    for (const hunk of fileDiff.hunks) {
      const start = hunk[startKey]
      const count = hunk[countKey]
      if (lineNumber >= start && lineNumber < start + count) {
        const index = hunk[indexKey] + (lineNumber - start)
        return lines[index] ?? ''
      }
    }
    return ''
  }

  const allAnnotations: DiffLineAnnotation<ReviewComment | { _pending: true }>[] = [
    ...annotations,
    ...(pending
      ? [
          {
            side: pending.side,
            lineNumber: pending.lineNumber,
            metadata: { _pending: true as const },
          },
        ]
      : []),
  ]

  return (
    <section className={`review-file-section ${viewed ? 'file-diff-viewed' : ''}`} id={id}>
      <div className="review-step-heading">
        <span className="review-step-number">{order}</span>
        <h2>{summary}</h2>
      </div>
      <div className="file-diff-card">
        <div className="file-diff-sticky-header">
          <button
            className="file-diff-collapse-btn"
            type="button"
            title={collapsed ? 'Expand diff' : 'Collapse diff'}
            aria-label={collapsed ? 'Expand diff' : 'Collapse diff'}
            onClick={() => setCollapsed((c) => !c)}
          >
            <ChevronDown className={`file-diff-chevron ${collapsed ? 'file-diff-chevron-collapsed' : ''}`} size={20} aria-hidden="true" />
          </button>
          <span className="file-diff-name">{fileName}</span>
          {directory && <span className="file-diff-directory">{directory}</span>}
          <span className="file-diff-header-spacer" />
          <button
            className="file-copy-button"
            type="button"
            title={`Copy ${filePath}`}
            aria-label={`Copy ${filePath}`}
            onClick={() => void navigator.clipboard?.writeText(filePath)}
          >
            <Copy size={17} aria-hidden="true" />
          </button>
          <span className="file-diff-additions">+{additions}</span>
          <span className="file-diff-deletions">−{deletions}</span>
          <span className="file-diff-header-divider" />
          <label className="viewed-label" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={viewed}
              onChange={(e) => onViewedChange(filePath, e.target.checked)}
            />
            Mark as viewed
          </label>
        </div>
        {!viewed && !collapsed && (
          <div className="file-diff-body" ref={diffBodyRef}>
            <FileDiff<ReviewComment | { _pending: true }>
              fileDiff={fileDiff}
              options={{
                diffStyle,
                enableGutterUtility: true,
                theme: { dark: 'github-dark', light: 'github-light' },
                themeType: 'dark',
                unsafeCSS: `
                  :host {
                    --diffs-tab-size: ${tabSize};
                    --diffs-dark-bg: #1b1b1c;
                    --diffs-bg-context-override: #202022;
                    --diffs-bg-separator-override: #202938;
                    --diffs-modified-color-override: #4db9ea;
                    --diffs-addition-color-override: #38d889;
                    --diffs-deletion-color-override: #ff6570;
                    --diffs-font-size: 13px;
                    --diffs-line-height: 20px;
                  }
                  [data-diffs-header] { display: none !important; }
                  [data-separator-wrapper] { color: #4db9ea !important; }
                `,
              }}
              lineAnnotations={allAnnotations}
              renderAnnotation={(annotation) => {
                if ('_pending' in annotation.metadata) {
                  return (
                    <CommentForm
                      onSubmit={async (body, askAgent) => {
                        const { side, lineNumber } = annotation
                        const lineContent = getLineContent(side, lineNumber)
                        await onAddComment(filePath, side, lineNumber, lineContent, body, askAgent)
                        setPending(null)
                      }}
                      onCancel={() => setPending(null)}
                    />
                  )
                }
                return (
                  <CommentBubble
                    comment={annotation.metadata as ReviewComment}
                    onDelete={onDeleteComment}
                  />
                )
              }}
              renderGutterUtility={(getHoveredLine) => (
                <button
                  className="gutter-add-btn"
                  onClick={() => {
                    const line = getHoveredLine()
                    if (line) {
                      setPending({ side: line.side, lineNumber: line.lineNumber })
                    }
                  }}
                >
                  +
                </button>
              )}
            />
            <SectionOverlays
              containerRef={diffBodyRef}
              sections={reviewMetadata?.sections ?? []}
              diffStyle={diffStyle}
            />
          </div>
        )}
      </div>
    </section>
  )
})
