import { getAddress } from '@zoltar/bot-shared/ethereum'
import type { SecurityPoolTarget } from '#monitoring/security-pool-auction'
import { record } from '@zoltar/bot-shared/infrastructure/json-validation'

export type InstructionIdentity = { id: string; fingerprint: string }
export function parseInstructionIdentity(value: unknown): InstructionIdentity | undefined {
	if (value === undefined) return undefined
	const data = record(value, 'Instruction identity')
	if (typeof data['id'] !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data['id']) || typeof data['fingerprint'] !== 'string' || data['fingerprint'].length > 4096) throw new Error('Invalid persisted security pool instruction')
	return { id: data['id'], fingerprint: data['fingerprint'] }
}
export function parseCompletedInstructions(value: unknown): Record<string, string> {
	if (value === undefined) return {}
	const entries = record(value, 'Completed security pool instructions')
	return Object.fromEntries(
		Object.entries(entries).map(([id, fingerprint]) => {
			const entry = parseInstructionIdentity({ id, fingerprint })
			if (entry === undefined) throw new Error('Missing security pool instruction')
			return [entry.id, entry.fingerprint]
		}),
	)
}

export type SecurityPoolFunding = { amount: bigint; target: SecurityPoolTarget }
export type SecurityPoolFundingEffect = { key: string; operation: 'fund' | 'consume' | 'withdraw'; amount: bigint; target?: SecurityPoolTarget | undefined }
function parseTarget(value: unknown): SecurityPoolTarget {
	if (typeof value === 'string' && /^[1-9]\d*$/.test(value) && BigInt(value) < 2n ** 96n) return BigInt(value)
	const data = record(value, 'Funding target')
	const bidId = data['bidId']
	if (typeof bidId !== 'string' || !/^[1-9]\d*$/.test(bidId) || BigInt(bidId) >= 2n ** 256n || typeof data['auction'] !== 'string' || typeof data['bidder'] !== 'string') throw new Error('Invalid funding target')
	return { auction: getAddress(data['auction']), bidder: getAddress(data['bidder']), bidId: BigInt(bidId) }
}
export function parseFundingEffect(value: unknown): SecurityPoolFundingEffect | undefined {
	if (value === undefined) return undefined
	const data = record(value, 'Security pool funding effect')
	const key = data['key']
	const operation = data['operation']
	const amount = data['amount']
	if (typeof key !== 'string' || !/^0x[0-9a-fA-F]{40}:0x[0-9a-fA-F]{40}$/.test(key) || (operation !== 'fund' && operation !== 'consume' && operation !== 'withdraw') || typeof amount !== 'string' || !/^(0|[1-9]\d*)$/.test(amount) || BigInt(amount) >= 2n ** 256n) throw new Error('Invalid security pool funding effect')
	return { key, operation, amount: BigInt(amount), ...(operation === 'fund' ? { target: parseTarget(data['target']) } : {}) }
}
export function parseSecurityPoolFunding(value: unknown): Record<string, SecurityPoolFunding> {
	if (value === undefined) return {}
	return Object.fromEntries(
		Object.entries(record(value, 'Security pool funding')).map(([key, entry]) => {
			const data = record(entry, 'Security pool funding entry')
			const parsed = parseFundingEffect({ key, operation: 'fund', amount: data['amount'], target: data['target'] })
			if (parsed?.target === undefined) throw new Error('Missing funding target')
			return [key, { amount: parsed.amount, target: parsed.target }]
		}),
	)
}
export function applySecurityPoolFundingEffect(current: Readonly<Record<string, SecurityPoolFunding>>, effect: SecurityPoolFundingEffect) {
	const previous = current[effect.key]
	const next = { ...current }
	let amount = 0n
	if (effect.operation === 'fund') amount = (previous?.amount ?? 0n) + effect.amount
	else if (effect.operation === 'withdraw' && (previous?.amount ?? 0n) > effect.amount) amount = (previous?.amount ?? 0n) - effect.amount
	if (amount === 0n) delete next[effect.key]
	else {
		const target = effect.target ?? previous?.target
		if (target === undefined) throw new Error('Funding target is missing')
		next[effect.key] = { amount, target }
	}
	return next
}
