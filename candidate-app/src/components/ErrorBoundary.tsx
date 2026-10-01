import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-lg w-full text-center space-y-5">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center">
                <AlertTriangle size={26} className="text-rose-400" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100">Something went wrong</h1>
              <p className="text-sm text-slate-400 mt-1">
                An unexpected error occurred. Please reload and try again.
              </p>
            </div>
            {import.meta.env.DEV && this.state.error && (
              <pre className="text-left text-xs bg-slate-900 border border-slate-700 rounded-lg p-4 overflow-auto text-rose-400 max-h-48">
                {this.state.error.message}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center px-5 py-2 bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
