import { useState, useRef, useEffect } from 'react'

interface CommentFormProps {
  onSubmit: (body: string, askAgent?: boolean) => Promise<void>
  onCancel: () => void
}

export function CommentForm({ onSubmit, onCancel }: CommentFormProps) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = async (askAgent = false) => {
    const trimmed = body.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit(trimmed, askAgent)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save your comment. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.altKey)) {
      e.preventDefault()
      void handleSubmit(e.altKey && !e.metaKey && !e.ctrlKey)
    }
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div className="comment-form">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Leave a review comment..."
        rows={3}
      />
      {error && <p role="alert">{error}</p>}
      <div className="comment-form-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button className="btn btn-secondary" onClick={() => void handleSubmit(true)} disabled={!body.trim() || saving} title="Option/Alt + Enter">
          Ask reviewer
        </button>
        <button className="btn btn-primary" onClick={() => void handleSubmit()} disabled={!body.trim() || saving} title="Command/Ctrl + Enter">
          {saving ? 'Saving…' : 'Comment'}
        </button>
      </div>
    </div>
  )
}
