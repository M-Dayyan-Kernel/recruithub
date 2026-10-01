import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Resizable, truncating table primitives.
 *
 * Two problems these solve, on every table in the app:
 *
 *  1. A long cell used to either blow the column out or wrap into a paragraph.
 *     `Td` truncates to a single line with an ellipsis and carries the full
 *     value as a native `title`, so hovering reveals it. Native title is used
 *     deliberately: a custom tooltip is clipped by the table's own
 *     `overflow-x-auto` wrapper, which is how the collapsed sidebar tooltips
 *     failed.
 *  2. Nothing could be widened. `Th` grows a drag grip on its right edge, and
 *     widths persist per table so a reviewer's layout survives navigation.
 */

const MIN_W = 72
const MAX_W = 720

export function useColumnWidths(tableKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`tbl:${tableKey}`) ?? '{}')
    } catch {
      return {}
    }
  })

  // Written on settle rather than on every pointer move.
  const persist = useCallback(
    (next: Record<string, number>) => {
      try {
        localStorage.setItem(`tbl:${tableKey}`, JSON.stringify(next))
      } catch {
        /* private mode: widths just will not persist */
      }
    },
    [tableKey],
  )

  const drag = useRef<{ id: string; startX: number; startW: number } | null>(null)

  const onPointerDown = useCallback(
    (id: string, e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const th = (e.currentTarget as HTMLElement).closest('th')
      drag.current = { id, startX: e.clientX, startW: th?.getBoundingClientRect().width ?? 160 }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [],
  )

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const next = Math.min(MAX_W, Math.max(MIN_W, d.startW + (e.clientX - d.startX)))
      setWidths((prev) => ({ ...prev, [d.id]: next }))
    }
    const up = () => {
      if (!drag.current) return
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidths((prev) => {
        persist(prev)
        return prev
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [persist])

  const reset = useCallback(() => {
    setWidths({})
    persist({})
  }, [persist])

  return { widths, onPointerDown, reset }
}

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className="scrollbar-thin-light overflow-x-auto">
      {/* `fixed` is what makes a set column width actually hold. */}
      <table className={`w-full table-fixed border-collapse ${className}`}>{children}</table>
    </div>
  )
}

export function Th({
  id,
  width,
  onResize,
  align = 'left',
  children,
}: {
  id: string
  width?: number
  /** Omit to make a column non-resizable, e.g. a trailing action cell. */
  onResize?: (id: string, e: React.PointerEvent<HTMLElement>) => void
  align?: 'left' | 'right' | 'center'
  children: ReactNode
}) {
  return (
    <th
      style={width ? { width } : undefined}
      className={`group relative select-none px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      }`}
    >
      <span className="block truncate">{children}</span>
      {onResize && (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize column"
          onPointerDown={(e) => onResize(id, e)}
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute -right-1 top-0 z-10 flex h-full w-2 cursor-col-resize items-center justify-center"
        >
          <span className="h-1/2 w-px bg-line-strong opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
      )}
    </th>
  )
}

export function Td({
  children,
  title,
  align = 'left',
  className = '',
  truncate = true,
}: {
  children: ReactNode
  /** The full value, shown on hover when the cell is clipped. */
  title?: string
  align?: 'left' | 'right' | 'center'
  className?: string
  /** Off for cells holding controls or badges, which must not be clipped. */
  truncate?: boolean
}) {
  return (
    <td
      className={`px-4 py-3 text-[13px] text-ink-muted ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${className}`}
    >
      {truncate ? (
        <div className="truncate" title={title}>
          {children}
        </div>
      ) : (
        children
      )}
    </td>
  )
}

export function Thead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line bg-surface-2">{children}</thead>
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>
}

export function Tr({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <tr
      onClick={onClick}
      className={`transition-colors hover:bg-surface-2 ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </tr>
  )
}
