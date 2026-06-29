import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Layout from '@/components/Layout'
import InterviewLandingPage from '@/pages/InterviewLandingPage'
import InterviewRoomPage from '@/pages/InterviewRoomPage'
import InterviewCompletePage from '@/pages/InterviewCompletePage'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <Toaster
        position="top-center"
        toastOptions={{ duration: 4000, style: { fontSize: '14px' } }}
      />
      <Routes>
        <Route element={<Layout />}>
          <Route path="interview/:token" element={<InterviewLandingPage />} />
          <Route path="interview/:token/room" element={<InterviewRoomPage />} />
          <Route path="interview/:token/complete" element={<InterviewCompletePage />} />
        </Route>
        {/* Catch-all → demo token */}
        <Route path="*" element={<Navigate to="/interview/demo" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}
