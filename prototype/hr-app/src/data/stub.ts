export type ParsingStatus = 'pending' | 'parsing' | 'ready' | 'failed'
export type ShortlistDecision = 'approved' | 'rejected' | 'overridden' | 'pending'
export type ScreeningResult = 'pass' | 'fail' | 'needs_review'
export type InterviewStatus = 'link_sent' | 'in_progress' | 'completed' | 'report_ready'

export interface Candidate {
  id: string
  name: string
  email: string
  phone: string
  parsingStatus: ParsingStatus
  skills: string[]
  experience: { role: string; company: string; duration: string }[]
  education: string
  matchScore?: number
  recommendation?: 'shortlist' | 'reject'
  strengths?: string[]
  gaps?: string[]
  reason?: string
  hrDecision?: ShortlistDecision
  screening?: {
    status: ScreeningResult
    availability: string
    employmentStatus: string
    currentCtc: string
    expectedCtc: string
    noticePeriod: string
    locationPref: string
    communicationQuality: string
    summary: string
  }
  interviewStatus?: InterviewStatus
  report?: {
    overallScore: number
    technicalFit: number
    communication: number
    problemSolving: number
    experience: number
    roleAlignment: number
    recommendation: string
    jdFit: string
    strengths: string[]
    weaknesses: string[]
    summary: string
    transcriptSummary: string
  }
}

export interface Job {
  id: string
  title: string
  description: string
  requiredSkills: string[]
  experienceMin: number
  experienceMax: number
  screeningCriteria: string
  interviewEvalCriteria: string
  status: 'draft' | 'active' | 'closed'
  candidateCount: number
  createdAt: string
}

export const jobs: Job[] = [
  {
    id: 'job-1',
    title: 'Senior Frontend Engineer',
    description: 'We are looking for a Senior Frontend Engineer to join our product team at Webknot. You will lead the development of our customer-facing web applications using React and TypeScript, collaborate closely with designers and backend engineers, and help establish frontend best practices across the engineering team.',
    requiredSkills: ['React', 'TypeScript', 'Tailwind CSS', 'REST APIs', 'Git'],
    experienceMin: 3,
    experienceMax: 6,
    screeningCriteria: 'Candidate must be immediately available or have notice period ≤ 30 days. Expected CTC must be within ₹18-25 LPA. Must be open to hybrid work from Bangalore.',
    interviewEvalCriteria: 'Evaluate: React architecture knowledge, TypeScript proficiency, problem-solving approach, system design thinking, communication clarity, culture fit.',
    status: 'active',
    candidateCount: 6,
    createdAt: '2026-06-15',
  },
  {
    id: 'job-2',
    title: 'Backend Engineer (Python)',
    description: 'Join our platform team to build and scale our Python-based microservices. You will work with FastAPI, PostgreSQL, and cloud infrastructure to deliver reliable, high-performance backend systems.',
    requiredSkills: ['Python', 'FastAPI', 'PostgreSQL', 'Docker', 'Redis'],
    experienceMin: 2,
    experienceMax: 5,
    screeningCriteria: 'Notice period ≤ 60 days. Open to Bangalore-based role. Expected CTC within ₹15-22 LPA.',
    interviewEvalCriteria: 'Evaluate: Python expertise, API design skills, database knowledge, understanding of async programming, system design.',
    status: 'active',
    candidateCount: 3,
    createdAt: '2026-06-17',
  },
]

export const candidates: Candidate[] = [
  {
    id: 'c1',
    name: 'Arjun Sharma',
    email: 'arjun.sharma@gmail.com',
    phone: '+91 98765 43210',
    parsingStatus: 'ready',
    skills: ['React', 'TypeScript', 'Node.js', 'GraphQL', 'Tailwind CSS', 'AWS'],
    experience: [
      { role: 'Senior Frontend Developer', company: 'Razorpay', duration: '2022 – Present (2 yrs)' },
      { role: 'Frontend Developer', company: 'Freshworks', duration: '2020 – 2022 (2 yrs)' },
    ],
    education: 'B.Tech Computer Science — NIT Trichy (2020)',
    matchScore: 92,
    recommendation: 'shortlist',
    strengths: ['Strong React & TypeScript expertise', 'Experience with fintech products at scale', 'Excellent GitHub portfolio'],
    gaps: ['No direct Tailwind CSS projects listed'],
    reason: 'Near-perfect skill match. 4 years of relevant React experience at top-tier companies.',
    hrDecision: 'approved',
    screening: {
      status: 'pass',
      availability: 'Available in 30 days',
      employmentStatus: 'Currently employed at Razorpay',
      currentCtc: '₹18 LPA',
      expectedCtc: '₹24 LPA',
      noticePeriod: '30 days',
      locationPref: 'Open to Bangalore hybrid',
      communicationQuality: 'Excellent — clear, confident, articulate',
      summary: 'Strong candidate. Motivated to move for better growth opportunities. Expectation fits budget. Ready to interview.',
    },
    interviewStatus: 'report_ready',
    report: {
      overallScore: 88,
      technicalFit: 9,
      communication: 9,
      problemSolving: 8,
      experience: 9,
      roleAlignment: 9,
      recommendation: 'Strong Hire ✅',
      jdFit: 'Arjun\'s experience at Razorpay and Freshworks aligns extremely well with the Senior Frontend Engineer role. His React and TypeScript skills are demonstrated through production-grade work at scale.',
      strengths: ['Deep React architecture knowledge', 'Strong TypeScript and typing discipline', 'Clear communicator under pressure', 'Proven at high-scale consumer products'],
      weaknesses: ['Limited exposure to design systems from scratch', 'Has not led a frontend team yet'],
      summary: 'Arjun performed exceptionally across all interview dimensions. He demonstrated architectural thinking, TypeScript depth, and excellent behavioral responses. A strong hire recommendation.',
      transcriptSummary: 'Candidate walked through a complex state management problem at Razorpay involving concurrent API calls and optimistic UI updates. Showed strong understanding of React Query, error boundaries, and accessibility. Behavioral questions showed ownership mindset.',
    },
  },
  {
    id: 'c2',
    name: 'Priya Nair',
    email: 'priya.nair@outlook.com',
    phone: '+91 87654 32109',
    parsingStatus: 'ready',
    skills: ['React', 'JavaScript', 'CSS', 'HTML', 'Vue.js'],
    experience: [
      { role: 'Frontend Developer', company: 'Infosys', duration: '2024 – Present (1 yr)' },
      { role: 'Junior Developer', company: 'TCS', duration: '2022 – 2024 (2 yrs)' },
    ],
    education: 'B.E. Information Technology — Anna University (2022)',
    matchScore: 61,
    recommendation: 'reject',
    strengths: ['React fundamentals solid', 'Strong CSS skills'],
    gaps: ['No TypeScript experience', 'Limited to service companies — no product experience', 'Under minimum experience threshold'],
    reason: 'Below experience threshold (3 yrs required). Lacks TypeScript and modern tooling.',
    hrDecision: 'rejected',
    screening: {
      status: 'fail',
      availability: 'Available in 60 days',
      employmentStatus: 'Currently employed at Infosys',
      currentCtc: '₹8 LPA',
      expectedCtc: '₹14 LPA',
      noticePeriod: '60 days',
      locationPref: 'Prefers remote',
      communicationQuality: 'Good — slightly hesitant',
      summary: 'Candidate does not meet minimum experience and TypeScript requirements. Notice period exceeds screening criteria.',
    },
  },
  {
    id: 'c3',
    name: 'Rahul Mehta',
    email: 'rahul.mehta@yahoo.com',
    phone: '+91 76543 21098',
    parsingStatus: 'ready',
    skills: ['React', 'TypeScript', 'Next.js', 'GraphQL', 'AWS', 'Docker', 'System Design'],
    experience: [
      { role: 'Principal Engineer', company: 'Flipkart', duration: '2021 – Present (3 yrs)' },
      { role: 'Senior Engineer', company: 'Zomato', duration: '2018 – 2021 (3 yrs)' },
      { role: 'Engineer', company: 'Wipro', duration: '2016 – 2018 (2 yrs)' },
    ],
    education: 'B.Tech — IIT Bombay (2016)',
    matchScore: 78,
    recommendation: 'shortlist',
    strengths: ['Very strong technical background', 'IIT + top product companies', 'Full-stack capable'],
    gaps: ['Possibly overqualified — Principal Engineer level', 'Likely high salary expectation'],
    reason: 'Strong technical profile but potentially overqualified. Recommend screening for motivation fit.',
    hrDecision: 'approved',
    screening: {
      status: 'needs_review',
      availability: 'Available in 90 days',
      employmentStatus: 'Currently employed at Flipkart',
      currentCtc: '₹42 LPA',
      expectedCtc: '₹50 LPA',
      noticePeriod: '90 days',
      locationPref: 'Open to Bangalore',
      communicationQuality: 'Excellent',
      summary: 'Expectation well above budget. Notice period exceeds criteria. Needs HR review to decide if exception warranted given profile strength.',
    },
  },
  {
    id: 'c4',
    name: 'Sneha Patel',
    email: 'sneha.patel@gmail.com',
    phone: '+91 65432 10987',
    parsingStatus: 'ready',
    skills: ['React', 'TypeScript', 'Tailwind CSS', 'REST APIs', 'Git', 'Figma'],
    experience: [
      { role: 'Frontend Engineer', company: 'Swiggy', duration: '2023 – Present (1.5 yrs)' },
      { role: 'Frontend Developer', company: 'Meesho', duration: '2021 – 2023 (2 yrs)' },
    ],
    education: 'B.Tech CSE — BITS Pilani (2021)',
    matchScore: 87,
    recommendation: 'shortlist',
    strengths: ['Exact skill match (React, TypeScript, Tailwind)', 'Product company experience', 'Strong portfolio'],
    gaps: ['Slightly under 3 years of senior-level work'],
    reason: 'Excellent skill alignment with the JD. Product experience at Swiggy and Meesho is highly relevant.',
    hrDecision: 'approved',
    screening: {
      status: 'pass',
      availability: 'Available in 45 days',
      employmentStatus: 'Currently employed at Swiggy',
      currentCtc: '₹16 LPA',
      expectedCtc: '₹22 LPA',
      noticePeriod: '45 days',
      locationPref: 'Open to Bangalore hybrid',
      communicationQuality: 'Very good — confident and structured',
      summary: 'Strong candidate. Good motivation for move. Expectation within budget. Slight notice period flexibility requested.',
    },
    interviewStatus: 'completed',
  },
  {
    id: 'c5',
    name: 'Vikram Iyer',
    email: 'vikram.iyer@gmail.com',
    phone: '+91 54321 09876',
    parsingStatus: 'ready',
    skills: ['HTML', 'CSS', 'JavaScript', 'React (basics)', 'Bootstrap'],
    experience: [
      { role: 'Web Developer', company: 'Freelance', duration: '2024 – Present (8 months)' },
    ],
    education: 'BCA — Bangalore University (2023)',
    matchScore: 34,
    recommendation: 'reject',
    strengths: ['Enthusiasm evident in cover letter'],
    gaps: ['Insufficient experience (< 1 year)', 'No TypeScript', 'No product company experience', 'Skills below requirement'],
    reason: 'Profile does not meet minimum requirements for a Senior role.',
    hrDecision: 'rejected',
  },
  {
    id: 'c6',
    name: 'Divya Krishnan',
    email: 'divya.krishnan@hotmail.com',
    phone: '',
    parsingStatus: 'parsing',
    skills: [],
    experience: [],
    education: '',
  },
]
