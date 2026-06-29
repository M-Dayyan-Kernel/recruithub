// Default-export Badge component — used by pages via ../components/Badge

type Variant = 'green' | 'red' | 'amber' | 'zinc' | 'indigo' | 'blue'

const styles: Record<Variant, string> = {
  green:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  red:    'bg-rose-50 text-rose-700 border border-rose-200',
  amber:  'bg-amber-50 text-amber-700 border border-amber-200',
  zinc:   'bg-zinc-100 text-zinc-600',
  indigo: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  blue:   'bg-blue-50 text-blue-700 border border-blue-200',
}

export default function Badge({
  children,
  variant = 'zinc',
}: {
  children: React.ReactNode
  variant?: Variant
}) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  )
}
