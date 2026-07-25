const DECIMAL_SCALE = 18

function parseSignedDecimal(value: string) {
	if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`Invalid decimal amount: ${value}`)
	const negative = value.startsWith('-')
	const unsigned = negative ? value.slice(1) : value
	const [whole = '0', fraction = ''] = unsigned.split('.')
	const scaled = BigInt(whole) * 10n ** BigInt(DECIMAL_SCALE) + BigInt(fraction.padEnd(DECIMAL_SCALE, '0'))
	return negative ? -scaled : scaled
}

function decimalFromScaled(value: bigint) {
	const negative = value < 0n
	const unsigned = negative ? -value : value
	const scale = 10n ** BigInt(DECIMAL_SCALE)
	const whole = unsigned / scale
	const fraction = (unsigned % scale).toString().padStart(DECIMAL_SCALE, '0').replace(/0+$/, '')
	const decimal = fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
	return negative ? `-${decimal}` : decimal
}

export function exactAmount(value: string | undefined, symbol: string) {
	return value === undefined ? 'Unavailable' : `${value} ${symbol}`
}

function compactDuration(seconds: number) {
	if (seconds < 60) return `${seconds.toString()}s`
	const minutes = Math.floor(seconds / 60)
	const remainder = seconds % 60
	if (minutes < 60) return remainder === 0 ? `${minutes.toString()}m` : `${minutes.toString()}m ${remainder.toString()}s`
	const hours = Math.floor(minutes / 60)
	const remainingMinutes = minutes % 60
	return remainingMinutes === 0 ? `${hours.toString()}h` : `${hours.toString()}h ${remainingMinutes.toString()}m`
}

export function blockAgeLabel(blockTimestamp: string | undefined, nowMilliseconds = Date.now()) {
	if (blockTimestamp === undefined || !/^(?:0|[1-9]\d*)$/.test(blockTimestamp)) return 'timestamp unavailable'
	const timestampMilliseconds = Number(blockTimestamp) * 1_000
	if (!Number.isSafeInteger(timestampMilliseconds) || !Number.isFinite(nowMilliseconds)) return 'timestamp unavailable'
	const differenceSeconds = Math.floor(Math.abs(nowMilliseconds - timestampMilliseconds) / 1_000)
	const label = compactDuration(differenceSeconds)
	return nowMilliseconds >= timestampMilliseconds ? `${label} behind` : `${label} ahead of local clock`
}

export function requiredSignerPrivateKey(value: string) {
	const privateKey = value.trim()
	if (privateKey === '') throw new Error('Enter a private key before setting the signer.')
	return privateKey
}

export function signerControlState(parameters: { hasQueuedSigner: boolean; hasWallet: boolean; privateKey: string; requestPending: boolean }) {
	return {
		clearDisabled: parameters.requestPending || (!parameters.hasWallet && !parameters.hasQueuedSigner),
		inputDisabled: parameters.requestPending,
		setDisabled: parameters.requestPending || parameters.privateKey.trim() === '',
	}
}

export function sumSignedDecimals(values: readonly string[]) {
	return decimalFromScaled(values.reduce((total, value) => total + parseSignedDecimal(value), 0n))
}
