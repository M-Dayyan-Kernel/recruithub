export default function InterviewComplete() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl">🎉</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">Interview Complete!</h1>
        <p className="text-slate-400 mb-2">
          Thank you for completing your interview. Your responses have been submitted and will be reviewed by the hiring team.
        </p>
        <p className="text-slate-500 text-sm">
          You can now close this window. We'll be in touch soon.
        </p>
        <div className="mt-8 bg-slate-900 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-500">Powered by</p>
          <p className="text-sm font-semibold text-indigo-400 mt-0.5">Olympus AI · Webknot</p>
        </div>
      </div>
    </div>
  )
}
