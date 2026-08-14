function mailError(message, status = 502, code = 'INVITATION_EMAIL_DELIVERY_FAILED') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
export function createInvitationMailer({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const webhookUrl = String(env.SHRINEFLOW_INVITATION_EMAIL_WEBHOOK_URL || '').trim();
  const webhookToken = String(env.SHRINEFLOW_INVITATION_EMAIL_WEBHOOK_TOKEN || '').trim();
  const enabled = Boolean(webhookUrl && typeof fetchImpl === 'function');

  async function send({
    email,
    invitationUrl,
    grants = [],
    invitedBy = '',
  } = {}) {
    if (!enabled) return { enabled: false, delivered: false };
    let response;
    try {
      response = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(webhookToken ? { Authorization: 'Bearer ' + webhookToken } : {}),
        },
        body: JSON.stringify({
          type: 'shrineflow.invitation',
          to: String(email || '').trim().toLowerCase(),
          invitationUrl: String(invitationUrl || ''),
          grants: grants.map((grant) => ({ clientId: grant.clientId, role: grant.role })),
          invitedBy: String(invitedBy || ''),
        }),
      });
    } catch (error) {
      throw mailError('Invitation email delivery failed: ' + (error.message || 'network error'));
    }
    if (!response?.ok) {
      throw mailError('Invitation email delivery failed with status ' + (response?.status || 502) + '.');
    }
    return { enabled: true, delivered: true };
  }

  return Object.freeze({ enabled, send });
}
