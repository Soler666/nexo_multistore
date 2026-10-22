const localeByCurrency: Record<string, string> = {
  COP: 'es-CO',
  USD: 'en-US',
  MXN: 'es-MX',
  EUR: 'es-ES',
}

export function formatCurrency(value: number | string, currency = 'COP') {
  const locale = localeByCurrency[currency] ?? 'es-CO'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'COP' ? 0 : 2,
  }).format(Number(value) || 0)
}

export function parseCurrencyInput(value: string, currency = 'COP') {
  const locale = localeByCurrency[currency] ?? 'es-CO'
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  const group = parts.find((part) => part.type === 'group')?.value ?? ','
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.'
  const normalized = value
    .trim()
    .replaceAll(group, '')
    .replaceAll(decimal, '.')
    .replace(/\s/g, '')
  const amount = Number(normalized)
  if (!normalized || !Number.isFinite(amount) || amount < 0) {
    throw new Error('Escribe un precio válido usando el formato de la moneda seleccionada.')
  }
  return amount
}
