import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import JobsList from './pages/JobsList'
import JobDetail from './pages/JobDetail'
import InterviewReport from './pages/InterviewReport'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="jobs" element={<JobsList />} />
        <Route path="jobs/:id" element={<JobDetail />} />
        <Route path="report/:id" element={<InterviewReport />} />
      </Route>
    </Routes>
  )
}
