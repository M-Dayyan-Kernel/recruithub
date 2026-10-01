// Stub interview sessions for candidate app
// In production these would be fetched from backend via token

export interface InterviewSession {
  token: string
  candidateName: string
  jobTitle: string
  company: string
  status: 'pending' | 'in_progress' | 'completed' | 'expired'
}

export const sessions: Record<string, InterviewSession> = {
  'demo-token-arjun': {
    token: 'demo-token-arjun',
    candidateName: 'Arjun Sharma',
    jobTitle: 'Senior Frontend Engineer',
    company: 'Webknot',
    status: 'pending',
  },
  'demo-token-sneha': {
    token: 'demo-token-sneha',
    candidateName: 'Sneha Patel',
    jobTitle: 'Senior Frontend Engineer',
    company: 'Webknot',
    status: 'completed',
  },
  'demo-token-expired': {
    token: 'demo-token-expired',
    candidateName: 'Test User',
    jobTitle: 'Backend Engineer',
    company: 'Webknot',
    status: 'expired',
  },
}
