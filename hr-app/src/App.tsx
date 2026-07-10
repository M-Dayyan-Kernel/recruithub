import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Layout from '@/components/Layout'
import DashboardPage from '@/pages/DashboardPage'
import CreateJobPage from '@/pages/CreateJobPage'
import JobLayout from '@/components/JobLayout'
import JobDetailsPage from '@/pages/JobDetailsPage'
import JobShortlistPage from '@/pages/JobShortlistPage'
import JobScreeningPage from '@/pages/JobScreeningPage'
import JobInterviewsPage from '@/pages/JobInterviewsPage'
import JobFinalistsPage from '@/pages/JobFinalistsPage'
import ArchivedJobsPage from '@/pages/ArchivedJobsPage'
import SettingsPage from '@/pages/SettingsPage'
import ReportPage from '@/pages/ReportPage'
import ShortlistReportPage from '@/pages/ShortlistReportPage'
import NotFoundPage from '@/pages/NotFoundPage'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: { fontSize: '14px' },
        }}
      />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="jobs" element={<Navigate to="/" replace />} />
          <Route path="jobs/new" element={<CreateJobPage />} />
          <Route path="jobs/archived" element={<ArchivedJobsPage />} />
          <Route path="jobs/:jobId" element={<JobLayout />}>
            <Route index element={<JobDetailsPage />} />
            <Route path="shortlist" element={<JobShortlistPage />} />
            <Route path="screening" element={<JobScreeningPage />} />
            <Route path="interviews" element={<JobInterviewsPage />} />
            <Route path="finalists" element={<JobFinalistsPage />} />
          </Route>
          <Route path="jobs/:jobId/candidates/:candidateId/report" element={<ReportPage />} />
          <Route path="jobs/:jobId/shortlist/:shortlistId" element={<ShortlistReportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
