import { getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { record, nonemptyString } from '@zoltar/bot-shared/infrastructure/json-validation'

type Scope = { id: string; securityPool: Address; universeId: bigint }
export type SecurityPoolInstruction = Scope &
	(
		| { action: 'auction-bid'; lots: bigint; minimumAttoRepPerLot: bigint; maximumValueAttoEth: bigint }
		| { action: 'auction-claim'; bidIds: readonly bigint[] }
		| { action: 'auction-refund'; bidId: bigint }
		| { action: 'capital-earnings' }
		| { action: 'capital-health'; targetHealthFactorBps: bigint }
		| { action: 'capital-retire'; commitmentAttoEth: bigint }
		| { action: 'capital-withdraw'; amountAttoRep: bigint }
		| { action: 'capital-deposit'; amountAttoRep: bigint; targetHealthFactorBps: bigint }
		| { action: 'fork-choice'; outcome: bigint }
	)
export type CapitalInstruction = Extract<SecurityPoolInstruction, { action: `capital-${string}` }>

/** Instructions are explicit, one-shot operator decisions; no bot chooses a truth branch or bid price. */
export function parseSecurityPoolInstructions(value: unknown): SecurityPoolInstruction[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.length > 64) throw new Error('securityPoolInstructions must contain at most 64 instructions')
	const result = value.map((entry): SecurityPoolInstruction => {
		const data = record(entry, 'Security pool instruction')
		const id = nonemptyString(data['id'], 'Instruction id')
		if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Instruction id must be 1–80 letters, digits, underscores or hyphens')
		const uint = (key: string, bits = 256) => {
			const raw = data[key]
			if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw) || BigInt(raw) >= 1n << BigInt(bits)) throw new Error(`Instruction ${key} must be a uint${bits} decimal string`)
			return BigInt(raw)
		}
		const securityPool = getAddress(nonemptyString(data['securityPool'], 'Instruction security pool'))
		if (securityPool === zeroAddress) throw new Error('Instruction security pool must be nonzero')
		const base = { id, securityPool, universeId: uint('universeId', 248) }
		const action = data['action']
		const health = () => {
			const value = uint('targetHealthFactorBps')
			if (value < 10_000n || value > 1_000_000n) throw new Error('Instruction health must be between 100% and 10000%')
			return value
		}
		if (action === 'fork-choice') return { ...base, action, outcome: uint('outcome') }
		if (action === 'auction-bid') {
			const lots = uint('lots', 128)
			const minimumAttoRepPerLot = uint('minimumAttoRepPerLot')
			const maximumValueAttoEth = uint('maximumValueAttoEth', 128)
			if (lots === 0n || minimumAttoRepPerLot === 0n || maximumValueAttoEth === 0n) throw new Error('Auction bid limits must be positive')
			return { ...base, action, lots, minimumAttoRepPerLot, maximumValueAttoEth }
		}
		if (action === 'auction-claim') {
			const raw = data['bidIds']
			if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) throw new Error('Instruction bidIds must list 1–64 bid IDs')
			const bidIds = raw.map(item => {
				if (typeof item !== 'string' || !/^[1-9]\d*$/.test(item) || BigInt(item) >= 1n << 256n) throw new Error('Instruction bidIds must be positive uint256 decimal strings')
				return BigInt(item)
			})
			if (new Set(bidIds).size !== bidIds.length) throw new Error('Instruction bidIds must not repeat a bid')
			return { ...base, action, bidIds }
		}
		if (action === 'auction-refund') {
			const bidId = uint('bidId')
			if (bidId === 0n) throw new Error('Instruction bidId must be positive')
			return { ...base, action, bidId }
		}
		// Claimed winning auction lots join the operator's own capital account; these act on it directly.
		if (action === 'capital-earnings') return { ...base, action }
		if (action === 'capital-health') return { ...base, action, targetHealthFactorBps: health() }
		if (action === 'capital-retire') return { ...base, action, commitmentAttoEth: uint('commitmentAttoEth') }
		if (action === 'capital-withdraw') return { ...base, action, amountAttoRep: uint('amountAttoRep') }
		if (action === 'capital-deposit') return { ...base, action, amountAttoRep: uint('amountAttoRep'), targetHealthFactorBps: health() }
		throw new Error('Unsupported security pool instruction action')
	})
	if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('Duplicate security pool instruction id')
	return result
}

function serializeValue(value: unknown): unknown {
	if (typeof value === 'bigint') return value.toString()
	return Array.isArray(value) ? value.map(serializeValue) : value
}

export function serializeSecurityPoolInstructions(instructions: readonly SecurityPoolInstruction[]) {
	return instructions.map(instruction => Object.fromEntries(Object.entries(instruction).map(([key, value]) => [key, serializeValue(value)])))
}
