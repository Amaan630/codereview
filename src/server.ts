import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, extname, resolve, relative } from 'node:path'
import { parsePatchFiles } from '@pierre/diffs'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { getBlame, getDiffBase, getRepoRoot, getGitDiff, getCustomGitDiff, getRepoName, getBranchName, getFileContent, isImageFile, getTabSizeForFiles, getUntrackedFilePaths } from './git.js'
import { loadSettings, saveSettings } from './settings.js'
import { InMemoryCommentStore } from './comments.js'
import type { CommentStore } from './comments.js'
import { isSafePath } from './path.js'
import { normalizeReviewManifest } from './review-manifest.js'
import type { ReviewManifest } from './review-manifest.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

function parseFilePaths(patch: string): string[] {
  const paths = new Set<string>()
  for (const line of patch.split('\n')) {
    const match = line.match(/^diff --git a\/.+ b\/(.+)$/)
    if (match) paths.add(match[1])
  }
  return [...paths]
}

function parseBinaryFiles(patch: string, untrackedFiles?: Set<string>): BinaryFileInfo[] {
  const binaryFiles: BinaryFileInfo[] = []
  const lines = patch.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('Binary files ') || !line.includes(' differ')) continue

    // Find the file path from the preceding diff --git line
    let filePath = ''
    for (let j = i - 1; j >= 0; j--) {
      const match = lines[j].match(/^diff --git a\/.+ b\/(.+)$/)
      if (match) {
        filePath = match[1]
        break
      }
    }
    if (!filePath) continue

    // Determine change type from surrounding lines
    let changeType: BinaryFileInfo['type'] = 'changed'
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].startsWith('diff --git')) break
      if (lines[j].startsWith('new file mode')) {
        changeType = 'added'
        break
      }
      if (lines[j].startsWith('deleted file mode')) {
        changeType = 'deleted'
        break
      }
    }

    if (changeType === 'added' && untrackedFiles?.has(filePath)) {
      changeType = 'untracked'
    }
    binaryFiles.push({ path: filePath, type: changeType })
  }
  return binaryFiles
}

export function createApp(
  clientDir: string,
  customDiffArgs?: string[],
  commentStore?: CommentStore,
  reviewManifest?: ReviewManifest | null,
  allChanges = false,
) {
  const app = new Hono()
  const isCustomMode = !!customDiffArgs || allChanges
  const store = commentStore ?? new InMemoryCommentStore()
  const viewedFiles = new Map<string, string>()
  const blameFiles = new Map<string, { path: string; revision: string; lastLine: number }>()

  app.get('/api/diff', (c) => {
    let patch: string
    const staged = allChanges || c.req.query('staged') === 'true'
    const untracked = allChanges || c.req.query('untracked') === 'true'
    if (customDiffArgs) {
      patch = getCustomGitDiff(customDiffArgs)
    } else {
      patch = getGitDiff({ staged, untracked })
    }
    blameFiles.clear()
    const oldFiles = parsePatchFiles(patch).flatMap((part) => part.files).filter((file) => file.prevObjectId && !/^0+$/.test(file.prevObjectId))
    if (oldFiles.length) {
      const revision = getDiffBase(customDiffArgs)
      const relativeArg = customDiffArgs?.find((arg) => arg === '--relative' || arg.startsWith('--relative='))
      const prefix = relativeArg === '--relative' ? relative(getRepoRoot(), process.cwd()) : relativeArg?.slice(11)
      for (const file of oldFiles) {
        blameFiles.set(JSON.stringify([file.prevName ?? file.name, file.prevObjectId]), {
          path: join(prefix ?? '', file.prevName ?? file.name),
          revision,
          lastLine: Math.max(0, ...file.hunks.map((hunk) => hunk.deletionStart + hunk.deletionCount - 1)),
        })
      }
    }
    const repoName = getRepoName()
    const branch = getBranchName()
    const untrackedFiles = untracked ? getUntrackedFilePaths() : []
    const untrackedSet = new Set(untrackedFiles)
    const binaryFiles = parseBinaryFiles(patch, untrackedSet)
    const filePaths = parseFilePaths(patch)
    const tabSizeMap = getTabSizeForFiles(filePaths)
    return c.json({
      patch,
      repoName,
      branch,
      customMode: isCustomMode,
      binaryFiles,
      tabSizeMap,
      untrackedFiles,
      reviewManifest,
    })
  })

  app.get('/api/blame', (c) => {
    const path = c.req.query('path') ?? ''
    const blob = c.req.query('blob') ?? ''
    const start = Number(c.req.query('start'))
    const end = Number(c.req.query('end'))
    const file = blameFiles.get(JSON.stringify([path, blob]))
    if (!file || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > file.lastLine) {
      return c.json({ error: 'Choose deleted lines in the current review' }, 400)
    }
    try {
      return c.json(getBlame(file.path, blob, file.revision, start, end))
    } catch {
      return c.json({ error: 'Git blame is unavailable for these lines' }, 422)
    }
  })

  app.get('/api/file-content', (c) => {
    const path = c.req.query('path')
    const version = c.req.query('version') as 'old' | 'new'
    if (!path || !version) {
      return c.json({ error: 'Missing path or version' }, 400)
    }
    const content = getFileContent(path, version)
    if (!content) {
      return c.json({ error: 'File not found' }, 404)
    }
    const ext = extname(path)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    return new Response(new Uint8Array(content), {
      headers: { 'Content-Type': contentType },
    })
  })

  app.get('/api/settings', (c) => {
    return c.json(loadSettings())
  })

  app.put('/api/settings', async (c) => {
    const body = await c.req.json()
    const settings = saveSettings(body)
    return c.json(settings)
  })

  app.get('/api/viewed', (c) => {
    return c.json(Object.fromEntries(viewedFiles))
  })

  app.put('/api/viewed', async (c) => {
    const { filePath, viewed, contentHash } = await c.req.json<{ filePath: string; viewed: boolean; contentHash?: string }>()
    if (viewed) {
      if (typeof contentHash !== 'string' || contentHash.length === 0) {
        return c.json({ error: 'non-empty contentHash required when marking viewed' }, 400)
      }
      viewedFiles.set(filePath, contentHash)
    } else {
      viewedFiles.delete(filePath)
    }
    return c.json({ ok: true })
  })

  app.get('/api/comments', async (c) => {
    const comments = await store.getAll()
    return c.json(comments)
  })

  app.get('/api/questions', async (c) => {
    const comments = await store.getAll()
    return c.json(comments.filter((comment) => comment.askAgent && comment.status === 'open' && comment.replies.length === 0))
  })

  app.post('/api/comments', async (c) => {
    const body = await c.req.json()
    if (body.askAgent) {
      const url = new URL(c.req.url)
      const origin = c.req.header('origin')
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        (origin && origin !== url.origin) ||
        c.req.header('content-type')?.split(';')[0].trim() !== 'application/json') {
        return c.json({ error: 'Ask questions from the local review page' }, 403)
      }
    }
    if (body.askAgent !== undefined && typeof body.askAgent !== 'boolean') {
      return c.json({ error: 'askAgent must be a boolean' }, 400)
    }
    if (body.askAgent && (
      typeof body.body !== 'string' || !body.body.trim() ||
      typeof body.filePath !== 'string' || !body.filePath ||
      !['additions', 'deletions'].includes(body.side) ||
      !Number.isSafeInteger(body.lineNumber) || body.lineNumber < 1 ||
      typeof body.lineContent !== 'string'
    )) {
      return c.json({ error: 'A question needs text and a code location' }, 400)
    }
    const comment = {
      id: crypto.randomUUID(),
      filePath: body.filePath,
      side: body.side,
      lineNumber: body.lineNumber,
      lineContent: body.lineContent,
      body: body.body,
      status: 'open' as const,
      createdAt: Date.now(),
      replies: [],
      ...(body.askAgent ? { askAgent: true } : {}),
    }
    const created = await store.add(comment)
    return c.json(created, 201)
  })

  app.put('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const { body, status } = await c.req.json()
    const updated = await store.update(id, { body, status })
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.post('/api/comments/:id/replies', async (c) => {
    const commentId = c.req.param('id')
    const { body } = await c.req.json()
    if (typeof body !== 'string' || !body.trim()) {
      return c.json({ error: 'Reply text is required' }, 400)
    }
    const reply = {
      id: crypto.randomUUID(),
      body,
      createdAt: Date.now(),
    }
    const updated = await store.addReply(commentId, reply)
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.delete('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await store.remove(id)
    if (!removed) return c.json({ error: 'Comment not found' }, 404)
    return c.json({ ok: true })
  })

  app.get('/*', async (c) => {
    let filePath = c.req.path
    if (filePath === '/') filePath = '/index.html'

    const relativePath = filePath.slice(1)
    if (!isSafePath(relativePath, clientDir)) {
      return c.text('Forbidden', 403)
    }
    const fullPath = resolve(clientDir, relativePath)
    try {
      const content = await readFile(fullPath)
      const ext = extname(fullPath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      })
    } catch {
      const indexContent = await readFile(join(clientDir, 'index.html'))
      return new Response(indexContent, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  })

  return app
}

export function startServer(options: {
  port: number
  host: string
  clientDir: string
  customDiffArgs?: string[]
  allChanges?: boolean
  reviewManifestPath?: string
}): Promise<{ port: number }> {
  const reviewManifest = options.reviewManifestPath
    ? normalizeReviewManifest(JSON.parse(readFileSync(options.reviewManifestPath, 'utf-8')))
    : null
  const app = createApp(
    options.clientDir,
    options.customDiffArgs,
    undefined,
    reviewManifest,
    options.allChanges,
  )

  return new Promise((resolve) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port,
      hostname: options.host,
    }, (info) => {
      resolve({ port: info.port })
    })
  })
}
