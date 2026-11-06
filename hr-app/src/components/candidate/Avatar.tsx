import { initialsOf } from '@/lib/timeAgo'
import { cn } from '@/lib/utils'

const SIZE = {
  sm: 'h-9 w-9 text-[12px]',
  lg: 'h-16 w-16 text-xl',
} as const

/** A candidate's initials in a circle. There are no photos, so this is the face of the candidate. */
export function Avatar({ name, size = 'sm', className }: { name: string; size?: keyof typeof SIZE; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full border border-line-strong bg-line-strong/70 font-semibold text-ink',
        SIZE[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}
