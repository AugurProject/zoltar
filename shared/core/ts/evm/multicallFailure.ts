const ERROR_STRING_SELECTOR = '0x08c379a0'
const PANIC_SELECTOR = '0x4e487b71'
const WORD_HEX_LENGTH = 64

function decodeErrorString(data: string) {
	if (!data.startsWith(ERROR_STRING_SELECTOR)) return undefined
	const payload = data.slice(ERROR_STRING_SELECTOR.length)
	const offset = Number.parseInt(payload.slice(0, WORD_HEX_LENGTH), 16)
	if (!Number.isSafeInteger(offset)) return undefined
	const lengthStart = offset * 2
	const length = Number.parseInt(payload.slice(lengthStart, lengthStart + WORD_HEX_LENGTH), 16)
	if (!Number.isSafeInteger(length)) return undefined
	const bytesHex = payload.slice(lengthStart + WORD_HEX_LENGTH, lengthStart + WORD_HEX_LENGTH + length * 2)
	if (bytesHex.length !== length * 2 || !/^[0-9a-f]*$/.test(bytesHex)) return undefined
	const bytes = Uint8Array.from({ length }, (_, index) => Number.parseInt(bytesHex.slice(index * 2, index * 2 + 2), 16))
	return new TextDecoder().decode(bytes)
}

/** Describes one failed Multicall3 entry, decoding a standard `Error(string)` or `Panic(uint256)` revert when present. */
export function multicallFailureMessage(returnData: unknown) {
	const data = typeof returnData === 'string' ? returnData.toLowerCase() : ''
	if (data === '' || data === '0x') return 'Multicall contract call failed: empty return data'
	const reason = decodeErrorString(data)
	if (reason !== undefined) return `Multicall contract call failed: execution reverted: ${reason}`
	if (data.startsWith(PANIC_SELECTOR)) return `Multicall contract call failed: panic 0x${data.slice(PANIC_SELECTOR.length)}`
	return `Multicall contract call failed: ${data.length > 74 ? `${data.slice(0, 74)}…` : data}`
}
