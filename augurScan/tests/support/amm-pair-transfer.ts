// An AMM pair LP Transfer log encoded through the compiled pair ABI and decoded the way the indexer stores it.
import { abiForKind } from '../../src/abi-catalog.ts'
import { encodeAbiParameters, encodeEventTopics, type Hex } from '../../src/ethereum.ts'
import { decodeLogRecord } from '../../src/metadata.ts'

export const encodedAmmPairTransfer = (from: string, to: string, value: bigint, emitter?: string) => {
	const event = abiForKind('ammPair')?.find(item => item.type === 'event' && item.name === 'Transfer')
	if (event?.type !== 'event') throw new Error('Missing compiled AMM pair Transfer event')
	const topics = encodeEventTopics({ abi: [event], eventName: 'Transfer', args: { from, to } }).flatMap(topic => (typeof topic === 'string' ? [topic] : []))
	const data: Hex = encodeAbiParameters([{ type: 'uint256' }], [value])
	const decoded = decodeLogRecord('ammPair', topics, data, new Map(), new Map(), emitter)
	if (decoded.arguments === undefined) throw new Error(`AMM pair Transfer did not decode: ${decoded.summary}`)
	return { topics, data, decoded, arguments: decoded.arguments }
}
