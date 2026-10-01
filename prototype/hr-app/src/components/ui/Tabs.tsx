import { cn } from '@/lib/utils'
import { createContext, useContext } from 'react'

const TabsContext = createContext<{ active: string; setActive: (v: string) => void }>({
  active: '',
  setActive: () => {},
})

export function Tabs({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string
  onValueChange: (v: string) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <TabsContext.Provider value={{ active: value, setActive: onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-0 border-b border-slate-200', className)}>
      {children}
    </div>
  )
}

export function TabsTrigger({
  value,
  children,
  badge,
}: {
  value: string
  children: React.ReactNode
  badge?: number
}) {
  const { active, setActive } = useContext(TabsContext)
  const isActive = active === value
  return (
    <button
      onClick={() => setActive(value)}
      className={cn(
        'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
        isActive
          ? 'border-indigo-600 text-indigo-600'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
      )}
    >
      {children}
      {badge !== undefined && (
        <span
          className={cn(
            'inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-xs font-medium',
            isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600',
          )}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string
  children: React.ReactNode
  className?: string
}) {
  const { active } = useContext(TabsContext)
  if (active !== value) return null
  return <div className={className}>{children}</div>
}
