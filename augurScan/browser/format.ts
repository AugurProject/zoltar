const groupedInteger = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export const exactNumber = (value: string | number | bigint | null | undefined): string => {
	if (value === null || value === undefined) return '—'
	if (typeof value === 'bigint' || (typeof value === 'string' && /^-?\d+$/.test(value))) return groupedInteger.format(BigInt(value))
	return Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US').format(Number(value)) : '—'
}

export const percentFromBps = (value: string | number | bigint | null | undefined): string => {
	if (value === null || value === undefined) return '—'
	const negative = String(value).startsWith('-')
	const digits = String(value).replace('-', '').padStart(3, '0')
	const whole = digits.slice(0, -2)
	const fraction = digits.slice(-2).replace(/0+$/, '')
	return `${negative ? '-' : ''}${exactNumber(whole)}${fraction ? `.${fraction}` : ''}%`
}

export const utcDateTime = (value: string | number | Date | null | undefined): string => {
	if (value === null || value === undefined || value === '') return '—'
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? '—' : `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`
}

export const exactUnit = (value: string | number | bigint | null | undefined, decimals = 18, symbol = ''): string => {
	if (value === null || value === undefined) return '—'
	const negative = String(value).startsWith('-')
	const digits = String(value)
		.replace('-', '')
		.padStart(decimals + 1, '0')
	const whole = (decimals === 0 ? digits : digits.slice(0, -decimals)) || '0'
	const fraction = decimals === 0 ? '' : digits.slice(-decimals).replace(/0+$/, '')
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}${symbol ? ` ${symbol}` : ''}`
}
