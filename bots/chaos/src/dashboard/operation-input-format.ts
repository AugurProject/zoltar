/** Convert without floating point so even single base units remain exact. */
export function displayOperationInput(kind: string, value: string) {
	if (value === '') return ''
	if (kind === 'amount' && /^\d+$/.test(value)) {
		const padded = value.padStart(19, '0')
		const fraction = padded.slice(-18).replace(/0+$/, '')
		return `${padded.slice(0, -18)}${fraction === '' ? '' : `.${fraction}`}`
	}
	if (kind === 'list') {
		const labels: unknown = JSON.parse(value)
		if (Array.isArray(labels) && labels.every(label => typeof label === 'string')) return labels.join('\n')
	}
	return value
}

export function serializeOperationInput(kind: string, value: string) {
	if (kind === 'amount') {
		if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) throw new Error('Enter an amount with at most 18 decimal places')
		const [whole, fraction = ''] = value.split('.')
		return BigInt(`${whole}${fraction.padEnd(18, '0')}`).toString()
	}
	if (kind === 'list') return JSON.stringify(value.split('\n'))
	return value
}
