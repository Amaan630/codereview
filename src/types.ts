export interface CommentReply {
  id: string
  body: string
  createdAt: number
}

export interface ReviewComment {
  id: string
  filePath: string
  side: 'deletions' | 'additions'
  lineNumber: number
  lineContent: string
  body: string
  status: 'open' | 'resolved'
  askAgent?: boolean
  createdAt: number
  replies: CommentReply[]
}

export interface BlameEntry {
  commit: string
  author: string
  summary: string
  lines: number
}
