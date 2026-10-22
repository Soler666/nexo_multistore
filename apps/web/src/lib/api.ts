const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = typeof payload?.error === 'string' ? payload.error : 'No se pudo completar la solicitud'
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/pdf') || contentType.includes('text/csv')) return response.blob() as T
  return response.json() as Promise<T>
}

export { apiBase }
