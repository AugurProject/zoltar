import type { Address, Hash, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import type { LiveBalances, LiveMarket, MarketLifecycle } from './liveMarket.js'
import { latestBlockIdentity, minimumAfterSlippage, requireTransactionSlippageBps, requireTransactionValidityMinutes, retainApprovedMinimum, simulateWithDeadline, stableSimulation, UI_SLIPPAGE_BPS, type GuardedWalletWrite, type TransactionExpiry } from './tradeQuote.js'
import { encodeReceiveBasedRedeemRequest, shareOperationRouter, shareTokenAbi } from './authorization.js'
import { loadTransactionFeeMarket, sellHoldingFeeBlocker } from './holdingFees.js'

const securityPoolAbi = statoblast_SecurityPool_SecurityPool.abi

export type SettlementOperation = 'redeem-complete-set' | 'redeem-winning-shares' | 'migrate-shares'
export type ShareOutcome = 'INVALID' | 'YES' | 'NO'

function outcomeValue(outcome: ShareOutcome) {
	if (outcome === 'INVALID') return 0n
	return outcome === 'YES' ? 1n : 2n
}

function normalizeForkOutcomeIndexes(targetOutcomeIndexes: readonly bigint[]) {
	if (targetOutcomeIndexes.length === 0) throw new Error('Select at least one fork target')
	const normalized = [...targetOutcomeIndexes].sort((left, right) => {
		if (left < right) return -1
		if (left > right) return 1
		return 0
	})
	for (let index = 0; index < normalized.length; index++) {
		const outcomeIndex = normalized[index]
		if (outcomeIndex === undefined || outcomeIndex < 0n || outcomeIndex >= 1n << 256n) throw new Error('Fork target is outside uint256')
		if (index > 0 && outcomeIndex === normalized[index - 1]) throw new Error('Select each fork target only once')
	}
	return normalized
}

type SettlementLifecycle = Pick<MarketLifecycle, 'loadError' | 'systemState' | 'universeForkTime' | 'questionOutcome'>
type SettlementBalances = Pick<LiveBalances, 'invalid' | 'yes' | 'no'> | undefined

export type SettlementUnavailableReason = Readonly<{ code: 'market-data-unavailable' | 'universe-not-forked' | 'no-shares-to-migrate' | 'universe-forked' | 'pool-not-operational' | 'no-complete-sets' | 'question-not-resolved' }> | Readonly<{ code: 'no-winning-shares'; outcome: ShareOutcome }>

function resolvedOutcome(questionOutcome: number): ShareOutcome | undefined {
	if (questionOutcome === 0) return 'INVALID'
	if (questionOutcome === 1) return 'YES'
	if (questionOutcome === 2) return 'NO'
	return undefined
}

function settlementHoldings(market: SettlementLifecycle, balances: SettlementBalances) {
	if (balances === undefined) return { completeSets: 0n, winningBalance: 0n, directionalBalance: 0n }
	const completeSets = [balances.invalid, balances.yes, balances.no].reduce((minimum, balance) => (balance < minimum ? balance : minimum))
	const outcome = resolvedOutcome(market.questionOutcome)
	let winningBalance = 0n
	if (outcome === 'INVALID') winningBalance = balances.invalid
	else if (outcome === 'YES') winningBalance = balances.yes
	else if (outcome === 'NO') winningBalance = balances.no
	return { completeSets, winningBalance, directionalBalance: balances.invalid + balances.yes + balances.no }
}

/** The canonical reason a settlement operation cannot run for this market and wallet, or undefined when it can. */
export function settlementUnavailability(operation: SettlementOperation, market: SettlementLifecycle, balances: SettlementBalances): SettlementUnavailableReason | undefined {
	const holdings = settlementHoldings(market, balances)
	if (market.loadError !== undefined) return { code: 'market-data-unavailable' }
	if (operation === 'migrate-shares') {
		if (market.universeForkTime === 0n) return { code: 'universe-not-forked' }
		return holdings.directionalBalance === 0n ? { code: 'no-shares-to-migrate' } : undefined
	}
	if (operation === 'redeem-complete-set') {
		if (market.universeForkTime !== 0n) return { code: 'universe-forked' }
		if (market.systemState !== 0) return { code: 'pool-not-operational' }
		return holdings.completeSets === 0n ? { code: 'no-complete-sets' } : undefined
	}
	if (market.systemState !== 0) return { code: 'pool-not-operational' }
	const outcome = resolvedOutcome(market.questionOutcome)
	if (outcome === undefined) return { code: 'question-not-resolved' }
	return holdings.winningBalance === 0n ? { code: 'no-winning-shares', outcome } : undefined
}

export function settlementAvailability(market: SettlementLifecycle, balances: SettlementBalances) {
	const { completeSets, winningBalance } = settlementHoldings(market, balances)
	return {
		completeSets,
		winningBalance,
		canRedeemCompleteSets: settlementUnavailability('redeem-complete-set', market, balances) === undefined,
		canRedeemWinningShares: settlementUnavailability('redeem-winning-shares', market, balances) === undefined,
		canMigrateShares: settlementUnavailability('migrate-shares', market, balances) === undefined,
	}
}

async function simulateSettlementWithExpiryParameters(
	client: WalletClient,
	configuration: DeploymentConfiguration,
	market: LiveMarket,
	account: Address,
	operation: SettlementOperation,
	parameters: Readonly<{ amount?: bigint; deadline?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> = {},
) {
	if (operation === 'redeem-complete-set') {
		requireTransactionSlippageBps(parameters.slippageBps ?? UI_SLIPPAGE_BPS)
		const amount = parameters.amount
		if (amount === undefined || amount <= 0n) throw new Error('Enter a positive complete-set share amount')
		const expiry: TransactionExpiry = parameters.deadline ?? { validityMinutes: parameters.validityMinutes ?? 20n }
		const slippageBps = parameters.slippageBps ?? UI_SLIPPAGE_BPS
		const {
			blockNumber,
			blockHash,
			deadline,
			result: simulation,
		} = await simulateWithDeadline(client, expiry, async (block, deadline) => {
			const feeMarket = await loadTransactionFeeMarket(client, market, block.blockHash, block.blockTimestamp)
			const invalidTokenId = market.universeId << 8n
			const estimatedEthOut = feeMarket.shareTokenSupplyAttoShares === 0n ? 0n : (amount * feeMarket.settlementCollateralAttoEth) / feeMarket.shareTokenSupplyAttoShares
			const minimumEth = minimumAfterSlippage(estimatedEthOut, slippageBps)
			const feeBlocker = sellHoldingFeeBlocker(feeMarket, amount, minimumEth, deadline)
			if (feeBlocker !== undefined) throw new Error(feeBlocker)
			const data = encodeReceiveBasedRedeemRequest(market, amount, minimumEth, account, deadline)
			const simulation = await client.simulateContract({
				abi: shareTokenAbi,
				address: market.shareToken,
				functionName: 'safeBatchTransferFrom',
				account,
				args: [account, shareOperationRouter(configuration), [invalidTokenId, invalidTokenId | 1n, invalidTokenId | 2n], [amount, amount, amount], data],
				blockHash: block.blockHash,
			})
			void simulation
			return { result: estimatedEthOut, feeMarket }
		})
		if (simulation.result <= 0n) throw new Error('Complete-set redemption would return zero ETH')
		return { blockNumber, blockHash, operation, market: simulation.feeMarket, amount, deadline, slippageBps, expectedAttoEth: simulation.result, minimumAttoEth: minimumAfterSlippage(simulation.result, slippageBps) }
	}
	if (operation === 'redeem-winning-shares') {
		const { blockNumber, blockHash } = await stableSimulation(client, async block => await client.simulateContract({ abi: securityPoolAbi, address: market.pool, functionName: 'redeemShares', account, args: [], blockHash: block.blockHash }))
		return { blockNumber, blockHash, operation, market }
	}
	if (parameters.sourceOutcome === undefined || parameters.targetOutcomeIndexes === undefined) throw new Error('Select a source share and at least one fork target')
	const sourceOutcome = parameters.sourceOutcome
	const targetOutcomeIndexes = normalizeForkOutcomeIndexes(parameters.targetOutcomeIndexes)
	const sourceTokenId = (market.universeId << 8n) | outcomeValue(sourceOutcome)
	const { blockNumber, blockHash } = await stableSimulation(client, async block => await client.simulateContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'migrate', account, args: [sourceTokenId, targetOutcomeIndexes], blockHash: block.blockHash }))
	return { blockNumber, blockHash, operation, market, sourceOutcome, targetOutcomeIndexes }
}

export async function simulateSettlement(
	client: WalletClient,
	configuration: DeploymentConfiguration,
	market: LiveMarket,
	account: Address,
	operation: SettlementOperation,
	parameters: Readonly<{ amount?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> = {},
) {
	if (operation === 'redeem-complete-set') {
		const validityMinutes = parameters.validityMinutes ?? 20n
		requireTransactionValidityMinutes(validityMinutes)
		const amount = parameters.amount
		const slippageBps = parameters.slippageBps
		return await simulateSettlementWithExpiryParameters(client, configuration, market, account, operation, { ...(amount === undefined ? {} : { amount }), validityMinutes, ...(slippageBps === undefined ? {} : { slippageBps }) })
	}
	if (operation === 'migrate-shares') {
		const sourceOutcome = parameters.sourceOutcome
		const targetOutcomeIndexes = parameters.targetOutcomeIndexes
		return await simulateSettlementWithExpiryParameters(client, configuration, market, account, operation, { ...(sourceOutcome === undefined ? {} : { sourceOutcome }), ...(targetOutcomeIndexes === undefined ? {} : { targetOutcomeIndexes }) })
	}
	return await simulateSettlementWithExpiryParameters(client, configuration, market, account, operation)
}

export async function submitFreshSettlement(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: Awaited<ReturnType<typeof simulateSettlement>>, guardedWrite: GuardedWalletWrite): Promise<Hash> {
	let parameters: Readonly<{ amount?: bigint; deadline?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> = {}
	if (quote.operation === 'redeem-complete-set') parameters = { amount: quote.amount, deadline: quote.deadline, slippageBps: quote.slippageBps }
	else if (quote.operation === 'migrate-shares') parameters = { sourceOutcome: quote.sourceOutcome, targetOutcomeIndexes: quote.targetOutcomeIndexes }
	const refreshed = await simulateSettlementWithExpiryParameters(client, configuration, quote.market, account, quote.operation, parameters)
	if (quote.operation === 'redeem-complete-set') {
		if (refreshed.operation !== 'redeem-complete-set') throw new Error('Settlement operation changed during revalidation')
		const minimumEth = retainApprovedMinimum(quote.minimumAttoEth, refreshed.expectedAttoEth, 'ETH output')
		const invalidTokenId = quote.market.universeId << 8n
		const data = encodeReceiveBasedRedeemRequest(quote.market, quote.amount, minimumEth, account, quote.deadline)
		return await guardedWrite(async () => {
			const block = await latestBlockIdentity(client)
			if (block.blockTimestamp >= quote.deadline) throw new Error('Transaction deadline has passed; simulate again')
			const feeMarket = await loadTransactionFeeMarket(client, quote.market, block.blockHash, block.blockTimestamp)
			const feeBlocker = sellHoldingFeeBlocker(feeMarket, quote.amount, minimumEth, quote.deadline)
			if (feeBlocker !== undefined) throw new Error(feeBlocker)
			return await client.writeContract({ abi: shareTokenAbi, address: quote.market.shareToken, functionName: 'safeBatchTransferFrom', account, args: [account, shareOperationRouter(configuration), [invalidTokenId, invalidTokenId | 1n, invalidTokenId | 2n], [quote.amount, quote.amount, quote.amount], data] })
		})
	}
	if (quote.operation === 'redeem-winning-shares') return await guardedWrite(async () => await client.writeContract({ abi: securityPoolAbi, address: quote.market.pool, functionName: 'redeemShares', account, args: [] }))
	const sourceTokenId = (quote.market.universeId << 8n) | outcomeValue(quote.sourceOutcome)
	return await guardedWrite(async () => await client.writeContract({ abi: shareTokenAbi, address: quote.market.shareToken, functionName: 'migrate', account, args: [sourceTokenId, quote.targetOutcomeIndexes] }))
}
