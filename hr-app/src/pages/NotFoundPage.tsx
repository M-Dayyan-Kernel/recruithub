import { Link } from 'react-router-dom'
import { SearchX } from 'lucide-react'

export default function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center">
            <SearchX size={28} className="text-indigo-400" />
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-indigo-600 uppercase tracking-wide mb-1">404</p>
          <h1 className="text-2xl font-bold text-slate-900">Page not found</h1>
          <p className="text-sm text-slate-500 mt-2">
            The page you're looking for doesn't exist or may have been moved.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex items-center px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
