export function isVoiceScreeningEffective(
  _settings?: { screening_enabled?: boolean } | null,
  job?: { voice_screening_enabled?: boolean } | null,
): boolean {
  return job?.voice_screening_enabled !== false
}
