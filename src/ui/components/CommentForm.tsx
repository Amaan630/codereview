import { useState, useRef, useEffect } from 'react'

interface CommentFormProps {
  onSubmit: (body: string) => Promise<void>
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

  const handleSubmit = async () => {
    const trimmed = body.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit(trimmed)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save your comment. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
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
        <button className="btn btn-primary" onClick={handleSubmit} disabled={!body.trim() || saving}>
          {saving ? 'Saving…' : 'Comment'}
        </button>
      </div>
    </div>
  )
}
