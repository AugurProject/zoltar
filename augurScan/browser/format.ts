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

const scaledAmount = (value: string | number | bigint | null | undefined, decimals: number): { readonly sign: string; readonly whole: string; readonly fraction: string } | undefined => {
	if (value === null || value === undefined) return undefined
	// Atomic token amounts are whole numbers; anything else ('null', '1.5', '1e+21') cannot be scaled exactly.
	if (!/^-?\d+$/.test(String(value))) return undefined
	const digits = String(value)
		.replace('-', '')
		.padStart(decimals + 1, '0')
	return {
		sign: String(value).startsWith('-') ? '-' : '',
		whole: (decimals === 0 ? digits : digits.slice(0, -decimals)) || '0',
		fraction: decimals === 0 ? '' : digits.slice(-decimals).replace(/0+$/, ''),
	}
}

/** An exact amount as a plain decimal without grouping or unit, for machine-readable exports; undefined when it cannot be scaled exactly. */
export const exactDecimal = (value: string | number | bigint | null | undefined, decimals = 18): string | undefined => {
	const amount = scaledAmount(value, decimals)
	return amount === undefined ? undefined : `${amount.sign}${amount.whole}${amount.fraction ? `.${amount.fraction}` : ''}`
}

export const exactUnit = (value: string | number | bigint | null | undefined, decimals = 18, symbol = ''): string => {
	const amount = scaledAmount(value, decimals)
	if (amount === undefined) return '—'
	const grouped = amount.whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	const number = `${amount.sign}${grouped}${amount.fraction ? `.${amount.fraction}` : ''}`
	// A percent sign follows its number directly, as percentFromBps writes it; every other unit is a separate word.
	if (symbol === '%') return `${number}%`
	return symbol ? `${number} ${symbol}` : number
}
