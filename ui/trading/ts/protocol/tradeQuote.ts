import type { Hash, WalletClient } from '@zoltar/shared/ethereum'

export const UI_SLIPPAGE_BPS = 50n

export function requireTransactionSlippageBps(slippageBps: bigint) {
	if (slippageBps < 0n || slippageBps > 500n) throw new Error('Slippage must be between 0% and 5%')
}

export function minimumAfterSlippage(amount: bigint, slippageBps = UI_SLIPPAGE_BPS) {
	requireTransactionSlippageBps(slippageBps)
	return (amount * (10_000n - slippageBps)) / 10_000n
}

export function maximumAfterSlippage(amount: bigint, slippageBps = UI_SLIPPAGE_BPS) {
	requireTransactionSlippageBps(slippageBps)
	return (amount * (10_000n + slippageBps) + 9_999n) / 10_000n
}

export async function latestBlockIdentity(client: Pick<WalletClient, 'getBlock'>) {
	const block = await client.getBlock()
	if (block.number === null || block.number === undefined || block.hash === null || block.hash === undefined) throw new Error('Latest block identity is unavailable')
	return { blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp }
}

export async function stableSimulation<T>(client: Pick<WalletClient, 'getBlock'>, simulate: (block: Readonly<{ blockNumber: bigint; blockHash: Hash; blockTimestamp: bigint }>) => Promise<T>) {
	const before = await latestBlockIdentity(client)
	const result = await simulate(before)
	const after = await latestBlockIdentity(client)
	if (after.blockNumber !== before.blockNumber || after.blockHash !== before.blockHash) throw new Error('Block changed during simulation; simulate again')
	return { ...before, result }
}

export type TransactionExpiry = bigint | Readonly<{ validityMinutes: bigint }>

export function requireTransactionValidityMinutes(validityMinutes: bigint) {
	if (validityMinutes < 1n || validityMinutes > 1_440n) throw new Error('Transaction validity must be between 1 and 1440 minutes')
}

export function deadlineAtBlock(expiry: TransactionExpiry, blockTimestamp: bigint) {
	if (typeof expiry === 'bigint') return expiry
	requireTransactionValidityMinutes(expiry.validityMinutes)
	return blockTimestamp + expiry.validityMinutes * 60n
}

export async function requireQuoteBlock(client: Pick<WalletClient, 'getBlock'>, quote: Readonly<{ blockNumber: bigint; blockHash: Hash }>) {
	const current = await latestBlockIdentity(client)
	if (current.blockNumber !== quote.blockNumber || current.blockHash !== quote.blockHash) throw new Error('Quote is stale; simulate again before submission')
}

export function retainApprovedMinimum(approved: bigint, refreshed: bigint, label: string) {
	if (refreshed < approved) throw new Error(`Refreshed quote no longer satisfies the approved minimum ${label}`)
	return approved
}

export function retainApprovedMaximum(approved: bigint, refreshed: bigint, label: string) {
	if (refreshed > approved) throw new Error(`Refreshed quote no longer satisfies the approved maximum ${label}`)
	return approved
}
