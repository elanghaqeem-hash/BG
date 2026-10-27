export type UserSession = { username: string; name: string; role: string; org: string; csrf: string };
export type VerificationResult = {
  authentic: boolean; valid: boolean; status: string; message: string;
  number?: string; amount?: string; currency?: string; principal?: string;
  obligee?: string; expires_on?: string; claim_window_open?: boolean; mode?: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorDetail(value: unknown): string {
  if (record(value) && typeof value.detail === 'string') return value.detail;
  return 'Respons layanan tidak dapat diproses. Silakan coba lagi.';
}

export function parseUser(value: unknown): UserSession {
  if (!record(value) || typeof value.username !== 'string' || typeof value.name !== 'string' ||
    typeof value.role !== 'string' || typeof value.org !== 'string' || typeof value.csrf !== 'string') {
    throw new Error('Respons sesi tidak valid. Silakan masuk kembali.');
  }
  return { username: value.username, name: value.name, role: value.role, org: value.org, csrf: value.csrf };
}

export function parseVerification(value: unknown): VerificationResult {
  if (!record(value) || typeof value.authentic !== 'boolean' || typeof value.valid !== 'boolean' ||
    typeof value.status !== 'string' || typeof value.message !== 'string') {
    throw new Error('Respons verifikasi tidak valid. Hubungi bank penerbit.');
  }
  const result: VerificationResult = { authentic: value.authentic, valid: value.valid, status: value.status, message: value.message };
  for (const field of ['number', 'amount', 'currency', 'principal', 'obligee', 'expires_on', 'mode'] as const) {
    const text = value[field];
    if (typeof text === 'string') result[field] = text;
  }
  if (typeof value.claim_window_open === 'boolean') result.claim_window_open = value.claim_window_open;
  return result;
}
