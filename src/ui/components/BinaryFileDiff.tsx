import type { BinaryFileInfo } from '../hooks/useDiff'
import type { ReviewFileMetadata } from '../../review-manifest'
import { ChevronDown, Copy } from 'lucide-react'

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif',
])

function isImage(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

interface BinaryFileDiffProps {
  filePath: string
  info: BinaryFileInfo
  viewed: boolean
  order: number
  reviewMetadata?: ReviewFileMetadata
  onViewedChange: (filePath: string, viewed: boolean) => void
}

export function BinaryFileDiff({ filePath, info, viewed, order, reviewMetadata, onViewedChange }: BinaryFileDiffProps) {
  const image = isImage(filePath)
  const separatorIndex = filePath.lastIndexOf('/')
  const fileName = separatorIndex === -1 ? filePath : filePath.slice(separatorIndex + 1)
  const directory = separatorIndex === -1 ? '' : filePath.slice(0, separatorIndex)
  const summary = reviewMetadata?.summary ?? reviewMetadata?.justification ?? `Review ${fileName}`

  return (
    <section className={`review-file-section ${viewed ? 'file-diff-viewed' : ''}`} id={`file-${filePath}`}>
      <div className="review-step-heading">
        <span className="review-step-number">{order}</span>
        <h2>{summary}</h2>
        <span className="review-step-progress">
          {viewed ? '1/1' : '0/1'}
          <span className={`review-step-status ${viewed ? 'review-step-status-viewed' : ''}`} />
        </span>
      </div>
      <div className="file-diff-card">
        <div className="file-diff-sticky-header">
          <ChevronDown className="file-diff-chevron" size={20} aria-hidden="true" />
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
        {!viewed && (
          <div className="binary-diff-body">
            {image ? (
              <ImagePreview filePath={filePath} changeType={info.type} />
            ) : (
              <div className="binary-diff-message">
                Binary file {info.type === 'added' ? 'added' : info.type === 'untracked' ? 'untracked' : info.type === 'deleted' ? 'deleted' : 'changed'}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function ImagePreview({ filePath, changeType }: { filePath: string; changeType: BinaryFileInfo['type'] }) {
  const oldSrc = `/api/file-content?path=${encodeURIComponent(filePath)}&version=old`
  const newSrc = `/api/file-content?path=${encodeURIComponent(filePath)}&version=new`

  if (changeType === 'added' || changeType === 'untracked') {
    return (
      <div className="image-preview">
        <div className="image-preview-panel">
          <div className="image-preview-label image-preview-label-added">Added</div>
          <img src={newSrc} alt={filePath} className="image-preview-img" />
        </div>
      </div>
    )
  }

  if (changeType === 'deleted') {
    return (
      <div className="image-preview">
        <div className="image-preview-panel">
          <div className="image-preview-label image-preview-label-deleted">Deleted</div>
          <img src={oldSrc} alt={filePath} className="image-preview-img image-preview-deleted" />
        </div>
      </div>
    )
  }

  return (
    <div className="image-preview image-preview-compare">
      <div className="image-preview-panel">
        <div className="image-preview-label">Before</div>
        <img src={oldSrc} alt={`${filePath} (before)`} className="image-preview-img" />
      </div>
      <div className="image-preview-panel">
        <div className="image-preview-label">After</div>
        <img src={newSrc} alt={`${filePath} (after)`} className="image-preview-img" />
      </div>
    </div>
  )
}
