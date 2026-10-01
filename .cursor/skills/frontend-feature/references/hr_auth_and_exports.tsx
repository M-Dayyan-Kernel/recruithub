/**
 * Reference: HR-app-only patterns — JWT auth (route guard) and exports
 * (PDF via jsPDF + jspdf-autotable, Excel via xlsx). Keep export logic in
 * dedicated utils/hooks, not inline in button handlers.
 */

// ===========================================================================
// AUTH — token in localStorage, attached by the Axios interceptor
// (see api_layer.ts). Guard authenticated routes with ONE wrapper, don't
// check auth ad-hoc in each page.
// ===========================================================================

// src/routes/RequireAuth.tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';

function isAuthenticated(): boolean {
  return Boolean(localStorage.getItem('auth_token'));
}

export function RequireAuth() {
  const location = useLocation();
  if (!isAuthenticated()) {
    // preserve intended destination so login can bounce back
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

// Usage in the route tree (App.tsx):
//   <Route element={<RequireAuth />}>
//     <Route path="/candidates" element={<CandidatesPage />} />
//   </Route>

// ===========================================================================
// EXCEL EXPORT — xlsx. One hook/util per export; typed input.
// ===========================================================================

// src/features/candidates/export/exportCandidatesExcel.ts
import * as XLSX from 'xlsx';
import type { Candidate } from '../types';

export function exportCandidatesExcel(candidates: Candidate[]): void {
  const rows = candidates.map((c) => ({
    Name: c.name,
    Email: c.email,
    Status: c.status,
    Score: c.score ?? '—',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Candidates');
  XLSX.writeFile(workbook, 'candidates.xlsx');
}

// ===========================================================================
// PDF EXPORT — jsPDF + jspdf-autotable. Note the autotable import side-effect.
// ===========================================================================

// src/features/candidates/export/exportCandidatesPdf.ts
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Candidate } from '../types';

export function exportCandidatesPdf(candidates: Candidate[]): void {
  const doc = new jsPDF();
  doc.text('Candidates', 14, 16);

  autoTable(doc, {
    startY: 22,
    head: [['Name', 'Email', 'Status', 'Score']],
    body: candidates.map((c) => [
      c.name,
      c.email,
      c.status,
      c.score?.toString() ?? '—',
    ]),
  });

  doc.save('candidates.pdf');
}

// ===========================================================================
// Consuming an export in a component — the button disables nothing async here,
// but toast on completion for feedback.
// ===========================================================================

// import toast from 'react-hot-toast';
// import { Download } from 'lucide-react';
//
// <button
//   onClick={() => { exportCandidatesExcel(data); toast.success('Exported'); }}
//   className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm text-white"
// >
//   <Download className="h-4 w-4" /> Export
// </button>
