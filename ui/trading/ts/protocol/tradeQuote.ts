import type { Hash, WalletClient } from '@zoltar/core-shared/evm/ethereum'

export const UI_SLIPPAGE_BPS = 50n

/** Runs a wallet write inside the caller's wallet-context guard, so a network or account change aborts the signature. */
export type GuardedWalletWrite = <T>(write: () => Promise<T>) => Promise<T>

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

// Every read inside `simulate` must pin `block.blockHash`, so a block landing mid-simulation cannot mix states.
export async function stableSimulation<T>(client: Pick<WalletClient, 'getBlock'>, simulate: (block: Readonly<{ blockNumber: bigint; blockHash: Hash; blockTimestamp: bigint }>) => Promise<T>) {
	const block = await latestBlockIdentity(client)
	return { ...block, result: await simulate(block) }
}

export type TransactionExpiry = bigint | Readonly<{ validityMinutes: bigint }>

export function requireTransactionValidityMinutes(validityMinutes: bigint) {
	if (validityMinutes < 1n || validityMinutes > 1_440n) throw new Error('Transaction validity must be between 1 and 1440 minutes')
}

function deadlineAtBlock(expiry: TransactionExpiry, blockTimestamp: bigint) {
	if (typeof expiry === 'bigint') return expiry
	requireTransactionValidityMinutes(expiry.validityMinutes)
	return blockTimestamp + expiry.validityMinutes * 60n
}

/** A stable simulation whose deadline is resolved against the pinned block's timestamp. */
export async function simulateWithDeadline<T>(client: Pick<WalletClient, 'getBlock'>, expiry: TransactionExpiry, simulate: (block: Readonly<{ blockNumber: bigint; blockHash: Hash; blockTimestamp: bigint }>, deadline: bigint) => Promise<T>) {
	const block = await latestBlockIdentity(client)
	const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
	return { blockNumber: block.blockNumber, blockHash: block.blockHash, deadline, result: await simulate(block, deadline) }
}

export function retainApprovedMinimum(approved: bigint, refreshed: bigint, label: string) {
	if (refreshed < approved) throw new Error(`Refreshed quote no longer satisfies the approved minimum ${label}`)
	return approved
}

export function retainApprovedMaximum(approved: bigint, refreshed: bigint, label: string) {
	if (refreshed > approved) throw new Error(`Refreshed quote no longer satisfies the approved maximum ${label}`)
	return approved
}
