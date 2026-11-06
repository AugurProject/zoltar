import { getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { record, nonemptyString } from '@zoltar/bot-shared/infrastructure/json-validation'

type Scope = { id: string; portfolio: Address; universeId: bigint }
export type PortfolioInstruction = Scope &
	(
		| { action: 'auction-bid'; lots: bigint; minimumAttoRepPerLot: bigint; targetHealthFactorBps: bigint; maximumValueAttoEth: bigint }
		| { action: 'auction-activate' | 'auction-refund'; bidId: bigint }
		| { action: 'vault-earnings'; vault: Address }
		| { action: 'vault-health'; vault: Address; targetHealthFactorBps: bigint }
		| { action: 'vault-retire'; vault: Address; commitmentAttoEth: bigint }
		| { action: 'vault-withdraw'; vault: Address; amountAttoRep: bigint }
		| { action: 'vault-deposit'; vault: Address; amountAttoRep: bigint; targetHealthFactorBps: bigint }
		| { action: 'vault-fork-choice'; vault: Address; outcome: bigint }
		| { action: 'fork-choice'; outcome: bigint }
	)

/** Instructions are explicit, one-shot operator decisions; no bot chooses a truth branch or bid price. */
export function parsePortfolioInstructions(value: unknown): PortfolioInstruction[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.length > 64) throw new Error('portfolioInstructions must contain at most 64 instructions')
	const result = value.map((entry): PortfolioInstruction => {
		const data = record(entry, 'Portfolio instruction')
		const id = nonemptyString(data['id'], 'Instruction id')
		if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Instruction id must be 1–80 letters, digits, underscores or hyphens')
		const uint = (key: string, bits = 256) => {
			const raw = data[key]
			if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw) || BigInt(raw) >= 1n << BigInt(bits)) throw new Error(`Instruction ${key} must be a uint${bits} decimal string`)
			return BigInt(raw)
		}
		const portfolio = getAddress(nonemptyString(data['portfolio'], 'Instruction portfolio'))
		if (portfolio === zeroAddress) throw new Error('Instruction portfolio must be nonzero')
		const base = { id, portfolio, universeId: uint('universeId', 248) }
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
			return { ...base, action, lots, minimumAttoRepPerLot, maximumValueAttoEth, targetHealthFactorBps: health() }
		}
		if (action === 'auction-activate' || action === 'auction-refund') {
			const bidId = uint('bidId')
			if (bidId === 0n) throw new Error('Instruction bidId must be positive')
			return { ...base, action, bidId }
		}
		const vault = getAddress(nonemptyString(data['vault'], 'Instruction vault'))
		if (vault === zeroAddress) throw new Error('Instruction vault must be nonzero')
		if (action === 'vault-earnings') return { ...base, action, vault }
		if (action === 'vault-health') return { ...base, action, vault, targetHealthFactorBps: health() }
		if (action === 'vault-retire') return { ...base, action, vault, commitmentAttoEth: uint('commitmentAttoEth') }
		if (action === 'vault-withdraw') return { ...base, action, vault, amountAttoRep: uint('amountAttoRep') }
		if (action === 'vault-deposit') return { ...base, action, vault, amountAttoRep: uint('amountAttoRep'), targetHealthFactorBps: health() }
		if (action === 'vault-fork-choice') return { ...base, action, vault, outcome: uint('outcome') }
		throw new Error('Unsupported portfolio instruction action')
	})
	if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('Duplicate portfolio instruction id')
	return result
}

export function serializePortfolioInstructions(instructions: readonly PortfolioInstruction[]) {
	return instructions.map(instruction => Object.fromEntries(Object.entries(instruction).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value])))
}
