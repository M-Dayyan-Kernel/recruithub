import { Routes, Route, Navigate } from 'react-router-dom'
import InterviewLanding from './pages/InterviewLanding'
import InterviewRoom from './pages/InterviewRoom'
import InterviewComplete from './pages/InterviewComplete'

export default function App() {
  return (
    <Routes>
      <Route path="/interview/:token" element={<InterviewLanding />} />
      <Route path="/interview/:token/room" element={<InterviewRoom />} />
      <Route path="/interview/:token/complete" element={<InterviewComplete />} />
      <Route path="*" element={<Navigate to="/interview/demo-token-arjun" replace />} />
    </Routes>
  )
}
