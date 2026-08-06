import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ReviewFileSection } from '../../review-manifest'

interface SectionOverlaysProps {
  containerRef: RefObject<HTMLElement | null>
  sections: ReviewFileSection[]
  diffStyle: 'split' | 'unified'
}

interface OverlayRect {
  top: number
  left: number
  width: number
  height: number
}

const OVERLAY_PADDING = 3

function findColumnRoot(shadow: ShadowRoot, diffStyle: 'split' | 'unified', side: 'additions' | 'deletions'): Element | null {
  if (diffStyle === 'unified') return shadow.querySelector('[data-unified]')
  return shadow.querySelector(side === 'additions' ? '[data-additions]' : '[data-deletions]')
}

// The diffs library only renders rows near the viewport (virtualization), so a
// section whose lines aren't currently mounted just measures to null and its
// overlay is skipped until it scrolls into range again.
function measureSection(
  host: Element,
  section: ReviewFileSection,
  diffStyle: 'split' | 'unified',
  containerRect: DOMRect
): OverlayRect | null {
  const shadow = host.shadowRoot
  if (!shadow) return null
  const root = findColumnRoot(shadow, diffStyle, section.side)
  if (!root) return null

  const lineType = section.side === 'additions' ? 'change-addition' : 'change-deletion'
  const typeSelector = diffStyle === 'unified' ? `[data-line-type="${lineType}"]` : ''

  let top: number | null = null
  let bottom: number | null = null
  let left = Infinity
  let right = -Infinity

  for (let line = section.startLine; line <= section.endLine; line++) {
    const el = root.querySelector(`${typeSelector}[data-line="${line}"]`)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (top === null) top = rect.top
    bottom = rect.bottom
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
  }

  if (top === null || bottom === null || !Number.isFinite(left) || !Number.isFinite(right)) return null

  return {
    top: top - containerRect.top - OVERLAY_PADDING,
    left: left - containerRect.left - OVERLAY_PADDING,
    width: right - left + OVERLAY_PADDING * 2,
    height: bottom - top + OVERLAY_PADDING * 2,
  }
}

export function SectionOverlays({ containerRef, sections, diffStyle }: SectionOverlaysProps) {
  const [rects, setRects] = useState<(OverlayRect | null)[]>([])
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || sections.length === 0) {
      setRects([])
      return
    }

    const measure = () => {
      const host = container.querySelector('diffs-container')
      const containerRect = container.getBoundingClientRect()
      setRects(sections.map((section) => (host ? measureSection(host, section, diffStyle, containerRect) : null)))
    }

    const scheduleMeasure = () => {
      if (frameRef.current != null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        measure()
      })
    }

    measure()
    window.addEventListener('resize', scheduleMeasure)

    // Overlay positions are computed relative to `container`, so page scroll
    // alone can't invalidate them. Rows still mount/unmount as they enter or
    // leave the virtualized render window (and the initial syntax highlight
    // swaps placeholder markup for real rows) — a MutationObserver on the
    // diff's shadow root catches both.
    let mutationObserver: MutationObserver | null = null
    const host = container.querySelector('diffs-container')
    if (host?.shadowRoot) {
      mutationObserver = new MutationObserver(scheduleMeasure)
      mutationObserver.observe(host.shadowRoot, { childList: true, subtree: true })
    }

    return () => {
      window.removeEventListener('resize', scheduleMeasure)
      mutationObserver?.disconnect()
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    }
  }, [containerRef, sections, diffStyle])

  return (
    <>
      {sections.map((section, index) => {
        const rect = rects[index]
        if (!rect) return null
        const open = openIndex === index
        return (
          <div
            key={`${section.side}-${section.startLine}-${section.endLine}`}
            className={`section-overlay ${open ? 'section-overlay-open' : ''}`}
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
            role="button"
            tabIndex={0}
            onClick={() => setOpenIndex(open ? null : index)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setOpenIndex(open ? null : index)
              }
            }}
          >
            {open && <div className="section-overlay-popover">{section.label}</div>}
          </div>
        )
      })}
    </>
  )
}
