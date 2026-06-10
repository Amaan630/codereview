import { memo } from 'react'
import type { FileDiffMetadata, DiffLineAnnotation, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import type { ReviewFileMetadata, ReviewManifestDiagnostics } from '../../review-manifest'
import type { BinaryFileInfo } from '../hooks/useDiff'
import { FileDiffCard } from './FileDiffCard'
import { BinaryFileDiff } from './BinaryFileDiff'

interface DiffViewerProps {
  files: FileDiffMetadata[]
  diffStyle: 'split' | 'unified'
  tabSizeMap: Record<string, number>
  defaultTabSize: number
  viewedFiles: Set<string>
  binaryFiles: Map<string, BinaryFileInfo>
  reviewMetadataByPath: Record<string, ReviewFileMetadata>
  reviewManifestDiagnostics: ReviewManifestDiagnostics
  onViewedChange: (filePath: string, viewed: boolean) => void
  fileAnnotationsMap: Map<string, DiffLineAnnotation<ReviewComment>[]>
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string) => void
  onDeleteComment: (id: string) => void
}

const emptyAnnotations: DiffLineAnnotation<ReviewComment>[] = []

export const DiffViewer = memo(function DiffViewer({
  files,
  diffStyle,
  tabSizeMap,
  defaultTabSize,
  viewedFiles,
  binaryFiles,
  reviewMetadataByPath,
  reviewManifestDiagnostics,
  onViewedChange,
  fileAnnotationsMap,
  onAddComment,
  onDeleteComment,
}: DiffViewerProps) {
  if (files.length === 0) {
    return (
      <div className="empty-state">
        <p>No changes found.</p>
      </div>
    )
  }

  return (
    <div className="diff-viewer">
      {(reviewManifestDiagnostics.filesMissingFromManifest.length > 0 ||
        reviewManifestDiagnostics.manifestPathsMissingFromDiff.length > 0) && (
        <div className="review-manifest-warning">
          {reviewManifestDiagnostics.filesMissingFromManifest.length > 0 && (
            <p>
              Files missing from review order: {reviewManifestDiagnostics.filesMissingFromManifest.join(', ')}
            </p>
          )}
          {reviewManifestDiagnostics.manifestPathsMissingFromDiff.length > 0 && (
            <p>
              Review order paths not in diff: {reviewManifestDiagnostics.manifestPathsMissingFromDiff.join(', ')}
            </p>
          )}
        </div>
      )}
      {files.map((file, index) => {
        const filePath = file.name
        const reviewMetadata = reviewMetadataByPath[filePath]
        const binaryInfo = binaryFiles.get(filePath)
        if (binaryInfo) {
          return (
            <BinaryFileDiff
              key={`${filePath}-${index}`}
              filePath={filePath}
              info={binaryInfo}
              viewed={viewedFiles.has(filePath)}
              reviewMetadata={reviewMetadata}
              onViewedChange={onViewedChange}
            />
          )
        }
        return (
          <FileDiffCard
            key={`${filePath}-${index}`}
            id={`file-${filePath}`}
            fileDiff={file}
            filePath={filePath}
            annotations={fileAnnotationsMap.get(filePath) ?? emptyAnnotations}
            diffStyle={diffStyle}
            tabSize={tabSizeMap[filePath] ?? defaultTabSize}
            viewed={viewedFiles.has(filePath)}
            reviewMetadata={reviewMetadata}
            onViewedChange={onViewedChange}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
          />
        )
      })}
    </div>
  )
})
