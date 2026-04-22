export function formatAddress(address: string | undefined, headLength: number = 6, tailLength: number = 4) {
	if (address === undefined) return '—'
	if (address.length <= headLength + tailLength + '…'.length) return address

	return `${address.slice(0, headLength)}…${address.slice(-tailLength)}`
}
