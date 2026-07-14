import { Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Layout from '@/components/Layout'
import DashboardPage from '@/pages/DashboardPage'
import JobsPage from '@/pages/JobsPage'
import CreateJobPage from '@/pages/CreateJobPage'
import JobLayout from '@/components/JobLayout'
import JobDetailsPage from '@/pages/JobDetailsPage'
import JobShortlistPage from '@/pages/JobShortlistPage'
import JobScreeningPage from '@/pages/JobScreeningPage'
import JobInterviewsPage from '@/pages/JobInterviewsPage'
import JobFinalistsPage from '@/pages/JobFinalistsPage'
import ArchivedJobsPage from '@/pages/ArchivedJobsPage'
import SettingsPage from '@/pages/SettingsPage'
import UsersPage from '@/pages/UsersPage'
import ActivityPage from '@/pages/ActivityPage'
import ReportPage from '@/pages/ReportPage'
import ShortlistReportPage from '@/pages/ShortlistReportPage'
import NotFoundPage from '@/pages/NotFoundPage'
import LoginPage from '@/pages/LoginPage'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AdminRoute, ProtectedRoute } from '@/components/ProtectedRoute'

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
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="jobs" element={<JobsPage />} />
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
            <Route element={<AdminRoute />}>
              <Route path="activity" element={<ActivityPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
