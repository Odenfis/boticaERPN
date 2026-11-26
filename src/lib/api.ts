export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'BoticaERP');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    if (contentType.includes('application/json')) {
      const data = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status,
        data.error || `Error ${response.status} en el servidor.`,
        data.code
      );
    }
    throw new ApiError(response.status, `Error ${response.status} al comunicarse con el servidor.`);
  }

  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

export async function apiDownloadFile(url: string, filenameFallback: string) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'X-Requested-With': 'BoticaERP' },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error || 'No se pudo descargar el archivo.');
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const cd = response.headers.get('content-disposition') || '';
  const match = /filename="([^"]+)"/.exec(cd);
  a.href = objectUrl;
  a.download = match ? match[1] : filenameFallback;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
