const ERROR_STRING_SELECTOR = '0x08c379a0'
const PANIC_SELECTOR = '0x4e487b71'
const WORD_HEX_LENGTH = 64

function decodeDynamicBytes(payload: string) {
	const offset = Number.parseInt(payload.slice(0, WORD_HEX_LENGTH), 16)
	if (!Number.isSafeInteger(offset)) return undefined
	const lengthStart = offset * 2
	const length = Number.parseInt(payload.slice(lengthStart, lengthStart + WORD_HEX_LENGTH), 16)
	if (!Number.isSafeInteger(length)) return undefined
	const bytesHex = payload.slice(lengthStart + WORD_HEX_LENGTH, lengthStart + WORD_HEX_LENGTH + length * 2)
	if (bytesHex.length !== length * 2 || !/^[0-9a-f]*$/.test(bytesHex)) return undefined
	return bytesHex
}

function describeRevert(data: string, depth = 0): string {
	if (data === '0x') return 'empty return data'
	if (data === '0x486aa307') return 'PoolNotInitialized()'
	if (data.startsWith(ERROR_STRING_SELECTOR)) {
		const bytesHex = decodeDynamicBytes(data.slice(ERROR_STRING_SELECTOR.length))
		if (bytesHex !== undefined) {
			const bytes = Uint8Array.from({ length: bytesHex.length / 2 }, (_, index) => Number.parseInt(bytesHex.slice(index * 2, index * 2 + 2), 16))
			return `execution reverted: ${new TextDecoder().decode(bytes)}`
		}
	}
	if (data.startsWith(PANIC_SELECTOR)) return `panic 0x${data.slice(PANIC_SELECTOR.length)}`
	// Uniswap V4's quoter wraps the actual swap revert in UnexpectedRevertBytes(bytes).
	if (depth < 4 && data.startsWith('0x6190b2b0')) {
		const bytesHex = decodeDynamicBytes(data.slice(10))
		if (bytesHex !== undefined) return `UnexpectedRevertBytes(${describeRevert(`0x${bytesHex}`, depth + 1)})`
	}
	return data
}

/** Describes one failed Multicall3 entry, decoding a standard `Error(string)` or `Panic(uint256)` revert when present. */
export function multicallFailureMessage(returnData: unknown) {
	const data = typeof returnData === 'string' ? returnData.toLowerCase() : ''
	if (data === '' || data === '0x') return 'Multicall contract call failed: empty return data'
	return `Multicall contract call failed: ${describeRevert(data)}`
}
