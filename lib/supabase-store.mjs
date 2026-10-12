export function createSupabaseStore(env = process.env, fetchImpl = fetch) {
  const baseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
  const secret = env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !secret) {
    const error = new Error('Supabase is not configured.');
    error.database = true;
    throw error;
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    const error = new Error('SUPABASE_URL must use HTTPS.');
    error.database = true;
    throw error;
  }

  async function request(path, options = {}) {
    const response = await fetchImpl(`${baseUrl}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: secret,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : `Supabase returned ${response.status}.`;
      const error = new Error(message);
      error.database = true;
      throw error;
    }
    return data;
  }

  return {
    async getSigners() {
      const rows = await request('signers?select=id,signed_at,method&order=id.asc');
      return rows.map((row) => ({ id: row.id, signedAt: row.signed_at, method: row.method }));
    },
    async issueInvite({ signerId, hash, expiresAt }) {
      return request('rpc/issue_signing_invite', {
        method: 'POST',
        body: JSON.stringify({ p_signer_id: signerId, p_token_hash: hash, p_expires_at: expiresAt }),
      });
    },
    async confirmInvite({ hash, strokes }) {
      const result = await request('rpc/confirm_email_signing', {
        method: 'POST',
        body: JSON.stringify({ p_token_hash: hash, p_signature_points: strokes }),
      });
      return typeof result === 'string' && result.length > 0;
    },
  };
}
