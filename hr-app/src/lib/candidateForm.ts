/**
 * Candidate Details form rules, kept apart from the component so they can be
 * unit tested and reused.
 *
 * Mandatory: name and email. They are the candidate's identity and contact
 * point (NOT NULL in the database) and every interview link goes to the email.
 * Everything else is optional, but validated when filled in. The API enforces
 * the same rules (CandidateUpdate in backend schemas), so this is feedback, not
 * the only line of defence.
 *
 * Dependency-free (type imports aside) so it runs under `node --test`.
 */

import type { CandidateProfile, CandidateUpdatePayload } from '../types/api.ts'
import {
  CANDIDATE_NAME_MAX_LENGTH,
  isPlaceholderEmail,
  validateEmail,
  validateName,
  validatePhone,
  validateShortText,
  validateYearsOfExperience,
} from './validation.ts'

export interface CandidateFormValues {
  name: string
  email: string
  phone: string
  status: string
  years_experience: string
  current_ctc: string
  expected_ctc: string
  notice_period: string
  last_working_day: string
}

export type CandidateFormField = keyof CandidateFormValues
export type CandidateFormErrors = Partial<Record<CandidateFormField, string>>

/** Fields that must be filled in before the details can be saved. */
export const CANDIDATE_REQUIRED_FIELDS: readonly CandidateFormField[] = ['name', 'email']

export function isRequiredCandidateField(field: CandidateFormField): boolean {
  return CANDIDATE_REQUIRED_FIELDS.includes(field)
}

/**
 * The statuses HR can set here. "on_hold" is retired and "rejected" is no longer a label:
 * rejecting is its own action (the Rejected stage). An old row still carrying one of them
 * opens as "active", so saving the form never rejects (or un-rejects) anyone by accident.
 */
export function editableStatus(status: string | null | undefined): string {
  return status === 'hired' ? 'hired' : 'active'
}

export function candidateFormFromProfile(profile: CandidateProfile): CandidateFormValues {
  return {
    name: profile.name ?? '',
    // A resume without an email gets a placeholder address. Show that as the
    // empty required field it really is, instead of a fake value that saves.
    email: isPlaceholderEmail(profile.email) ? '' : (profile.email ?? ''),
    phone: profile.phone ?? '',
    status: editableStatus(profile.status),
    years_experience: profile.years_experience?.toString() ?? '',
    current_ctc: profile.current_ctc ?? '',
    expected_ctc: profile.expected_ctc ?? '',
    notice_period: profile.notice_period ?? '',
    last_working_day: profile.last_working_day ?? '',
  }
}

/** Error message for one field, or undefined when it is valid. */
export function validateCandidateField(
  field: CandidateFormField,
  values: CandidateFormValues,
): string | undefined {
  let error: string | null = null
  switch (field) {
    case 'name':
      error = validateName(values.name, 'Name', CANDIDATE_NAME_MAX_LENGTH)
      break
    case 'email':
      error = isPlaceholderEmail(values.email)
        ? "Enter the candidate's real email address"
        : validateEmail(values.email, 'Email')
      break
    case 'phone':
      error = validatePhone(values.phone, 'Phone')
      break
    case 'years_experience':
      error = validateYearsOfExperience(values.years_experience)
      break
    case 'current_ctc':
      error = validateShortText(values.current_ctc, 'Current CTC')
      break
    case 'expected_ctc':
      error = validateShortText(values.expected_ctc, 'Expected CTC')
      break
    case 'notice_period':
      error = validateShortText(values.notice_period, 'Notice period')
      break
    default:
      error = null
  }
  return error ?? undefined
}

const FIELD_ORDER: readonly CandidateFormField[] = [
  'name',
  'email',
  'phone',
  'years_experience',
  'current_ctc',
  'expected_ctc',
  'notice_period',
  'last_working_day',
  'status',
]

export function validateCandidateForm(values: CandidateFormValues): CandidateFormErrors {
  const errors: CandidateFormErrors = {}
  for (const field of FIELD_ORDER) {
    const message = validateCandidateField(field, values)
    if (message) errors[field] = message
  }
  return errors
}

/** First invalid field in on-screen order, for moving focus after a failed save. */
export function firstInvalidField(errors: CandidateFormErrors): CandidateFormField | undefined {
  return FIELD_ORDER.find((field) => errors[field])
}

/**
 * The details to save. `status` is sent only when HR changed it from what the form opened
 * with: an old row can carry a retired label (on_hold, rejected) that the form shows as
 * "active", and saving a phone number must not rewrite it as a side effect.
 */
export function candidateUpdatePayload(
  values: CandidateFormValues,
  initial?: CandidateFormValues,
): CandidateUpdatePayload {
  const text = (value: string) => value.trim() || null
  const { status, ...rest } = buildPayload(values, text)
  return initial && initial.status === values.status ? rest : { ...rest, status }
}

function buildPayload(values: CandidateFormValues, text: (value: string) => string | null): CandidateUpdatePayload {
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    phone: text(values.phone),
    status: values.status,
    years_experience: values.years_experience.trim() ? Number(values.years_experience) : null,
    current_ctc: text(values.current_ctc),
    expected_ctc: text(values.expected_ctc),
    notice_period: text(values.notice_period),
    last_working_day: text(values.last_working_day),
  }
}
