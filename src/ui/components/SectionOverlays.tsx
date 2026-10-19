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
): OverlayRect[] {
  const shadow = host.shadowRoot
  if (!shadow) return []
  const root = findColumnRoot(shadow, diffStyle, section.side)
  if (!root) return []

  const lineType = section.side === 'additions' ? 'change-addition' : 'change-deletion'
  const typeSelector = diffStyle === 'unified' ? `[data-line-type="${lineType}"]` : ''

  const rects: OverlayRect[] = []
  let previousBottom = -Infinity
  for (let line = section.startLine; line <= section.endLine; line++) {
    const el = root.querySelector(`${typeSelector}[data-line="${line}"]`)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    const previous = rects.at(-1)
    if (previous && Math.abs(rect.top - previousBottom) < 1) {
      previous.height = rect.bottom - containerRect.top - previous.top + OVERLAY_PADDING
    } else {
      rects.push({
        top: rect.top - containerRect.top - OVERLAY_PADDING,
        left: rect.left - containerRect.left,
        width: rect.width,
        height: rect.height + OVERLAY_PADDING * 2,
      })
    }
    previousBottom = rect.bottom
  }
  return rects
}

export function SectionOverlays({ containerRef, sections, diffStyle }: SectionOverlaysProps) {
  const [rects, setRects] = useState<OverlayRect[][]>([])
  const [openPart, setOpenPart] = useState<string | null>(null)
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
      setRects(sections.map((section) => (host ? measureSection(host, section, diffStyle, containerRect) : [])))
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
    const resizeObserver = new ResizeObserver(scheduleMeasure)
    resizeObserver.observe(container)

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
      resizeObserver.disconnect()
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    }
  }, [containerRef, sections, diffStyle])

  return (
    <>
      {sections.flatMap((section, index) => (rects[index] ?? []).map((rect, part) => {
        const key = `${section.side}-${section.startLine}-${section.endLine}-${part}`
        const open = openPart === key
        return (
          <div
            key={key}
            className={`section-overlay ${open ? 'section-overlay-open' : ''}`}
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
            role="button"
            tabIndex={0}
            onClick={() => setOpenPart(open ? null : key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setOpenPart(open ? null : key)
              }
            }}
          >
            {open && <div className="section-overlay-popover">{section.label}</div>}
          </div>
        )
      }))}
    </>
  )
}
