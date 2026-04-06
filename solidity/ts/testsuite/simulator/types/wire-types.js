import * as funtypes from 'funtypes'
const BigIntParser = {
	parse: value => {
		if (!/^0x([a-fA-F0-9]{1,64})$/.test(value)) return { success: false, message: `${value} is not a hex string encoded number.` }
		return { success: true, value: BigInt(value) }
	},
	serialize: value => {
		if (typeof value !== 'bigint') return { success: false, message: `${typeof value} is not a bigint.` }
		if (value < 0n) return { success: false, message: `${value} must be non-negative.` }
		return { success: true, value: `0x${value.toString(16)}` }
	},
}
const SmallIntParser = {
	parse: value => {
		if (!/^0x([a-fA-F0-9]{1,64})$/.test(value)) return { success: false, message: `${value} is not a hex string encoded number.` }
		if (BigInt(value) >= 2n ** 64n) return { success: false, message: `${value} must be smaller than 2^64.` }
		return { success: true, value: BigInt(value) }
	},
	serialize: value => {
		if (typeof value !== 'bigint') return { success: false, message: `${typeof value} is not a bigint.` }
		if (value < 0n) return { success: false, message: `${value} must be non-negative.` }
		if (value >= 2n ** 64n) return { success: false, message: `${value} must be smaller than 2^64.` }
		return { success: true, value: `0x${value.toString(16)}` }
	},
}
const Bytes32Parser = {
	parse: value => {
		if (!/^0x([a-fA-F0-9]{64})$/.test(value)) return { success: false, message: `${value} is not a hex string encoded 32 byte value.` }
		return { success: true, value: BigInt(value) }
	},
	serialize: value => {
		if (typeof value !== 'bigint') return { success: false, message: `${typeof value} is not a bigint.` }
		if (value < 0n) return { success: false, message: `${value} must be non-negative.` }
		if (value >= 2n ** 256n) return { success: false, message: `${value} is too large for a 32-byte value.` }
		return { success: true, value: `0x${value.toString(16).padStart(64, '0')}` }
	},
}
const BytesParser = {
	parse: value => {
		const match = /^(?:0x)?([a-fA-F0-9]*)$/.exec(value)
		if (match === null) return { success: false, message: `Expected a hex string encoded byte array with an optional '0x' prefix but received ${value}` }
		const normalized = match[1]
		if (normalized === undefined) return { success: false, message: `Expected a hex string encoded byte array with an optional '0x' prefix but received ${value}` }
		if (normalized.length % 2) return { success: false, message: 'Hex string encoded byte array must be an even number of characters long.' }
		const bytes = new Uint8Array(normalized.length / 2)
		for (let i = 0; i < normalized.length; i += 2) {
			bytes[i / 2] = Number.parseInt(`${normalized[i]}${normalized[i + 1]}`, 16)
		}
		return { success: true, value: new Uint8Array(bytes) }
	},
	serialize: value => {
		if (!(value instanceof Uint8Array)) return { success: false, message: `${typeof value} is not a Uint8Array.` }
		let result = ''
		for (let i = 0; i < value.length; ++i) {
			const val = value[i]
			if (val === undefined) return { success: false, message: `${typeof value} is not a Uint8Array.` }
			result += ('0' + val.toString(16)).slice(-2)
		}
		return { success: true, value: `0x${result}` }
	},
}
const EthereumQuantity = funtypes.String.withParser(BigIntParser)
const EthereumQuantitySmall = funtypes.String.withParser(SmallIntParser)
const EthereumData = funtypes.String.withParser(BytesParser)
export const EthereumBytes32 = funtypes.String.withParser(Bytes32Parser)
//# sourceMappingURL=wire-types.js.map
