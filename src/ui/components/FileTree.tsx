import { useState, useMemo } from 'react'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  File,
  FilePlus,
  FileMinus,
  FileDiff,
  FileEdit,
  FileCheck,
  FileQuestion,
  MessageSquare,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ReviewFileMetadata } from '../../review-manifest'

interface FileTreeProps {
  files: FileDiffMetadata[]
  activeFile: string | null
  commentCounts: Record<string, number>
  viewedFiles: Set<string>
  untrackedFiles: Set<string>
  reviewMetadataByPath: Record<string, ReviewFileMetadata>
  onFileClick: (filePath: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  file?: FileDiffMetadata
  reviewOrder?: number
}

function buildTree(
  files: FileDiffMetadata[],
  reviewMetadataByPath: Record<string, ReviewFileMetadata>
): TreeNode[] {
  const root: TreeNode[] = []

  for (const file of files) {
    const parts = file.name.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const path = parts.slice(0, i + 1).join('/')
      const isDir = i < parts.length - 1

      let existing = current.find((n) => n.name === name && n.isDir === isDir)
      if (!existing) {
        existing = { name, path, isDir, children: [] }
        if (!isDir) {
          existing.file = file
          existing.reviewOrder = reviewMetadataByPath[file.name]?.order
        }
        current.push(existing)
      }
      current = existing.children
    }
  }

  function assignDirectoryOrder(nodes: TreeNode[]): number | undefined {
    let minOrder: number | undefined
    for (const node of nodes) {
      if (node.isDir) node.reviewOrder = assignDirectoryOrder(node.children)
      if (node.reviewOrder === undefined) continue
      minOrder = minOrder === undefined ? node.reviewOrder : Math.min(minOrder, node.reviewOrder)
    }
    return minOrder
  }

  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.reviewOrder !== undefined && b.reviewOrder !== undefined) {
        return a.reviewOrder - b.reviewOrder || a.name.localeCompare(b.name)
      }
      if (a.reviewOrder !== undefined) return -1
      if (b.reviewOrder !== undefined) return 1
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.isDir) sortNodes(node.children)
    }
  }
  assignDirectoryOrder(root)
  sortNodes(root)

  return root
}

function inferChangeType(file: FileDiffMetadata, untrackedFiles: Set<string>): string {
  if (untrackedFiles.has(file.name)) return 'untracked'
  // parsePatchFiles doesn't always set changeType, infer from object IDs
  if (file.prevName) return 'rename-changed'
  const prev = file.prevObjectId
  const next = file.newObjectId
  if (prev === '0000000' || prev === '0000000000000000000000000000000000000000') return 'new'
  if (next === '0000000' || next === '0000000000000000000000000000000000000000') return 'deleted'
  return 'change'
}

function getFileIcon(file: FileDiffMetadata | undefined, viewed: boolean, untrackedFiles: Set<string>) {
  const size = 16
  if (viewed) {
    return <FileCheck size={size} className="ft-icon icon-viewed" />
  }
  const changeType = file ? inferChangeType(file, untrackedFiles) : 'change'
  switch (changeType) {
    case 'new':
      return <FilePlus size={size} className="ft-icon icon-added" />
    case 'untracked':
      return <FileQuestion size={size} className="ft-icon icon-untracked" />
    case 'deleted':
      return <FileMinus size={size} className="ft-icon icon-deleted" />
    case 'rename-pure':
    case 'rename-changed':
      return <FileEdit size={size} className="ft-icon icon-renamed" />
    default:
      return <FileDiff size={size} className="ft-icon icon-modified" />
  }
}

function TreeDir({
  node,
  activeFile,
  commentCounts,
  viewedFiles,
  untrackedFiles,
  reviewMetadataByPath,
  onFileClick,
  depth,
  defaultExpanded,
}: {
  node: TreeNode
  activeFile: string | null
  commentCounts: Record<string, number>
  viewedFiles: Set<string>
  untrackedFiles: Set<string>
  reviewMetadataByPath: Record<string, ReviewFileMetadata>
  onFileClick: (filePath: string) => void
  depth: number
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <li>
      <div
        className="ft-row ft-dir"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={14}
          className={`ft-chevron ${expanded ? 'ft-chevron-expanded' : ''}`}
        />
        {expanded ? (
          <FolderOpen size={16} className="ft-icon ft-folder-icon" />
        ) : (
          <Folder size={16} className="ft-icon ft-folder-icon" />
        )}
        <span className="ft-dir-name">{node.name}</span>
      </div>
      {expanded && (
        <ul className="ft-list">
          {node.children.map((child) =>
            child.isDir ? (
              <TreeDir
                key={child.path}
                node={child}
                activeFile={activeFile}
                commentCounts={commentCounts}
                viewedFiles={viewedFiles}
                untrackedFiles={untrackedFiles}
                reviewMetadataByPath={reviewMetadataByPath}
                onFileClick={onFileClick}
                depth={depth + 1}
                defaultExpanded={true}
              />
            ) : (
              <TreeFile
                key={child.path}
                node={child}
                activeFile={activeFile}
                commentCount={commentCounts[child.file?.name ?? ''] ?? 0}
                viewed={viewedFiles.has(child.file?.name ?? '')}
                untrackedFiles={untrackedFiles}
                reviewMetadata={reviewMetadataByPath[child.file?.name ?? '']}
                onFileClick={onFileClick}
                depth={depth + 1}
              />
            ),
          )}
        </ul>
      )}
    </li>
  )
}

function TreeFile({
  node,
  activeFile,
  commentCount,
  viewed,
  untrackedFiles,
  reviewMetadata,
  onFileClick,
  depth,
}: {
  node: TreeNode
  activeFile: string | null
  commentCount: number
  viewed: boolean
  untrackedFiles: Set<string>
  reviewMetadata?: ReviewFileMetadata
  onFileClick: (filePath: string) => void
  depth: number
}) {
  const filePath = node.file?.name ?? node.path
  const isActive = activeFile === filePath

  return (
    <li>
      <div
        className={`ft-row ft-file ${isActive ? 'ft-file-active' : ''} ${viewed ? 'ft-file-viewed' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16 + 20}px` }}
        onClick={() => onFileClick(filePath)}
        title={filePath}
      >
        {getFileIcon(node.file, viewed, untrackedFiles)}
        <span className="ft-file-content">
          <span className="ft-file-name">{node.name}</span>
          {reviewMetadata && (
            <span className="ft-file-justification">
              <span className="ft-file-order">#{reviewMetadata.order}</span>
              {reviewMetadata.justification}
            </span>
          )}
        </span>
        {commentCount > 0 && (
          <span className="ft-comment-count">
            <MessageSquare size={14} />
            {commentCount}
          </span>
        )}
      </div>
    </li>
  )
}

export function FileTree({
  files,
  activeFile,
  commentCounts,
  viewedFiles,
  untrackedFiles,
  reviewMetadataByPath,
  onFileClick,
  collapsed,
  onToggleCollapse,
}: FileTreeProps) {
  const [filter, setFilter] = useState('')

  const filteredFiles = useMemo(() => {
    if (!filter) return files
    const lower = filter.toLowerCase()
    return files.filter((f) => f.name.toLowerCase().includes(lower))
  }, [files, filter])

  const tree = useMemo(
    () => buildTree(filteredFiles, reviewMetadataByPath),
    [filteredFiles, reviewMetadataByPath]
  )

  if (collapsed) {
    return (
      <div className="ft">
        <div className="ft-search">
          {onToggleCollapse && (
            <button
              className="sidebar-toggle"
              onClick={onToggleCollapse}
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ft">
      <div className="ft-search">
        {onToggleCollapse && (
          <button
            className="sidebar-toggle"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
        <div className="ft-search-wrapper">
          <Search size={14} className="ft-search-icon" />
          <input
            type="text"
            placeholder="Filter files..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ft-search-input"
          />
        </div>
      </div>
      <ul className="ft-list ft-root">
        {tree.map((node) =>
          node.isDir ? (
            <TreeDir
              key={node.path}
              node={node}
              activeFile={activeFile}
              commentCounts={commentCounts}
              viewedFiles={viewedFiles}
              untrackedFiles={untrackedFiles}
              reviewMetadataByPath={reviewMetadataByPath}
              onFileClick={onFileClick}
              depth={0}
              defaultExpanded={true}
            />
          ) : (
            <TreeFile
              key={node.path}
              node={node}
              activeFile={activeFile}
              commentCount={commentCounts[node.file?.name ?? ''] ?? 0}
              viewed={viewedFiles.has(node.file?.name ?? '')}
              untrackedFiles={untrackedFiles}
              reviewMetadata={reviewMetadataByPath[node.file?.name ?? '']}
              onFileClick={onFileClick}
              depth={0}
            />
          ),
        )}
      </ul>
    </div>
  )
}
