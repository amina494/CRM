// Thin fetch wrapper: JSON in/out, throws Error(message) on failure.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

api.get = (p) => api(p);
api.post = (p, body = {}) => api(p, { method: 'POST', body });
api.put = (p, body) => api(p, { method: 'PUT', body });
api.del = (p) => api(p, { method: 'DELETE' });
