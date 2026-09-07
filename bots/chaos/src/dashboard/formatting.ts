function formatAtomic18(value: string | number | undefined) {
	if (value === undefined) return '—'
	let atomic = ''
	if (typeof value === 'string') atomic = value
	else if (Number.isSafeInteger(value) && value >= 0) atomic = value.toString()
	if (!/^(?:0|[1-9]\d*)$/.test(atomic)) return 'Invalid atomic balance'
	const padded = atomic.padStart(19, '0')
	const integer = padded.slice(0, -18).replace(/^0+(?=\d)/, '')
	return `${integer}.${padded.slice(-18)}`
}

Object.assign(globalThis, { formatAtomic18 })
