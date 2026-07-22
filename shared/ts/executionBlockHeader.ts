import { bytesToHex, hexToBytes, keccak256, type Hex } from './ethereum.js'

const HEADER_FIELDS = [
	'parentHash',
	'sha3Uncles',
	'miner',
	'stateRoot',
	'transactionsRoot',
	'receiptsRoot',
	'logsBloom',
	'difficulty',
	'number',
	'gasLimit',
	'gasUsed',
	'timestamp',
	'extraData',
	'mixHash',
	'nonce',
	'baseFeePerGas',
	'withdrawalsRoot',
	'blobGasUsed',
	'excessBlobGas',
	'parentBeaconBlockRoot',
	'requestsHash',
] as const

const QUANTITY_FIELDS = new Set(['difficulty', 'number', 'gasLimit', 'gasUsed', 'timestamp', 'baseFeePerGas', 'blobGasUsed', 'excessBlobGas'])

const concatBytes = (parts: readonly Uint8Array[]) => {
	const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
	let offset = 0
	for (const part of parts) {
		result.set(part, offset)
		offset += part.length
	}
	return result
}

const bigintBytes = (value: bigint) => (value === 0n ? new Uint8Array() : hexToBytes(`0x${value.toString(16)}`))

const encodeLength = (length: number, shortOffset: number, longOffset: number) => {
	if (length <= 55) return Uint8Array.of(shortOffset + length)
	const encodedLength = bigintBytes(BigInt(length))
	return concatBytes([Uint8Array.of(longOffset + encodedLength.length), encodedLength])
}

const encodeBytes = (value: Uint8Array) => {
	if (value.length === 1 && value[0] !== undefined && value[0] < 0x80) return value
	return concatBytes([encodeLength(value.length, 0x80, 0xb7), value])
}

const encodeList = (values: readonly Uint8Array[]) => {
	const payload = concatBytes(values)
	return concatBytes([encodeLength(payload.length, 0xc0, 0xf7), payload])
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export function encodeExecutionBlockHeaderRlp(rawBlock: unknown, blockNumber: bigint): Hex {
	if (!isRecord(rawBlock)) throw new Error(`Block ${blockNumber.toString()} is unavailable`)
	const encodedFields: Uint8Array[] = []
	let optionalTailStarted = false
	for (const field of HEADER_FIELDS) {
		const rawValue = field === 'requestsHash' ? (rawBlock[field] ?? rawBlock['requestsRoot']) : rawBlock[field]
		if (rawValue === undefined || rawValue === null) {
			optionalTailStarted = true
			continue
		}
		if (optionalTailStarted) throw new Error(`Block ${blockNumber.toString()} has a non-contiguous optional header field ${field}`)
		const value = (() => {
			if (QUANTITY_FIELDS.has(field)) {
				if (typeof rawValue === 'bigint') return bigintBytes(rawValue)
				if (typeof rawValue === 'string' && rawValue.startsWith('0x')) return bigintBytes(BigInt(rawValue))
				throw new Error(`Block ${blockNumber.toString()} has an invalid ${field}`)
			}
			if (typeof rawValue !== 'string' || !rawValue.startsWith('0x')) throw new Error(`Block ${blockNumber.toString()} has an invalid ${field}`)
			return hexToBytes(rawValue)
		})()
		encodedFields.push(encodeBytes(value))
	}
	const encodedHeader = bytesToHex(encodeList(encodedFields))
	const blockHash = rawBlock['hash']
	if (typeof blockHash !== 'string' || keccak256(encodedHeader).toLowerCase() !== blockHash.toLowerCase()) {
		throw new Error(`Reconstructed execution header does not match block ${blockNumber.toString()}`)
	}
	return encodedHeader
}
