export function formatPen(centimos: number | null | undefined): string {
  const safe = Number(centimos || 0) / 100;
  return `S/ ${safe.toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function solesToCentimos(solesInput: string | number): number {
  const n = typeof solesInput === 'number' ? solesInput : Number(String(solesInput).replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function formatLimaDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function formatLimaDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function todayLimaIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}-${parts.find((p) => p.type === 'day')?.value}`;
}

export function firstDayOfMonthLimaIso(): string {
  return `${todayLimaIso().slice(0, 7)}-01`;
}
