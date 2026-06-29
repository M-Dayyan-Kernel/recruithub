import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Briefcase,
  Users,
  BrainCircuit,
} from 'lucide-react'

const navItems = [
  { to: '/',      icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/jobs',  icon: Briefcase,       label: 'Jobs' },
]

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-slate-900 flex flex-col z-40">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
          <BrainCircuit size={18} className="text-white" />
        </div>
        <div>
          <div className="text-white font-semibold text-sm leading-tight">RecruitAI</div>
          <div className="text-slate-500 text-xs">HR Portal</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <p className="text-slate-500 text-[11px] uppercase tracking-wider font-medium px-3 mb-2">
          Navigation
        </p>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white',
              )
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom info */}
      <div className="px-5 py-4 border-t border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-semibold">
            P
          </div>
          <div>
            <div className="text-white text-xs font-medium">Pranav</div>
            <div className="text-slate-500 text-[11px]">HR Administrator</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
