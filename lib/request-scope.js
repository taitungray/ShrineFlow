export function requestedOrAccessibleClientId(request, requested = '', fallback = '') {
  const explicit = String(requested || '').trim();
  if (explicit) return explicit;
  if (Array.isArray(request?.accessibleClientIds)) return request.accessibleClientIds[0] || '';
  return String(fallback || '').trim();
}

export function canAccessClient(request, clientId) {
  if (!Array.isArray(request?.accessibleClientIds)) return true;
  return request.accessibleClientIds.includes(String(clientId || '').trim());
}

export function filterAccessibleClients(records = [], request, explicitClientId = '') {
  const explicit = String(explicitClientId || '').trim();
  return (records || []).filter((record) => (
    (!explicit || record?.clientId === explicit)
    && canAccessClient(request, record?.clientId)
  ));
}
