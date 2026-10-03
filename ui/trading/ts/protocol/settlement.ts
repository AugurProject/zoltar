import { outcomeValue, simulateSettlement } from './settlementSimulation.js'
import type { Address, Hash, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { getReportingOutcomeKey } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import type { DeploymentConfiguration } from './config.js'
import type { LiveBalances, LiveMarket, MarketLifecycle } from './liveMarket.js'
import { latestBlockIdentity, retainApprovedMinimum, type GuardedWalletWrite, type TransactionExpiry } from './tradeQuote.js'
import { encodeReceiveBasedRedeemRequest, shareOperationRouter, shareTokenAbi } from './authorization.js'
import { loadTransactionFeeMarket, sellHoldingFeeBlocker } from './holdingFees.js'

const securityPoolAbi = statoblast_SecurityPool_SecurityPool.abi

export type SettlementOperation = 'redeem-complete-set' | 'redeem-winning-shares' | 'migrate-shares'
export type ShareOutcome = 'INVALID' | 'YES' | 'NO'

type SettlementLifecycle = Pick<MarketLifecycle, 'loadError' | 'systemState' | 'universeForkTime' | 'questionOutcome'>
type SettlementBalances = Pick<LiveBalances, 'invalid' | 'yes' | 'no'> | undefined

export type SettlementUnavailableReason = Readonly<{ code: 'market-data-unavailable' | 'universe-not-forked' | 'no-shares-to-migrate' | 'universe-forked' | 'pool-not-operational' | 'no-complete-sets' | 'question-not-resolved' }> | Readonly<{ code: 'no-winning-shares'; outcome: ShareOutcome }>

const SHARE_OUTCOME_BY_KEY = { invalid: 'INVALID', yes: 'YES', no: 'NO' } as const satisfies Record<'invalid' | 'yes' | 'no', ShareOutcome>

/** The winning share for a resolved question, or undefined while the question is unresolved. */
export function resolvedShareOutcome(questionOutcome: number): ShareOutcome | undefined {
	const key = getReportingOutcomeKey(questionOutcome)
	return key === 'none' ? undefined : SHARE_OUTCOME_BY_KEY[key]
}

function settlementHoldings(market: SettlementLifecycle, balances: SettlementBalances) {
	if (balances === undefined) return { completeSets: 0n, winningBalance: 0n, directionalBalance: 0n }
	const completeSets = [balances.invalid, balances.yes, balances.no].reduce((minimum, balance) => (balance < minimum ? balance : minimum))
	const outcome = resolvedShareOutcome(market.questionOutcome)
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
	const outcome = resolvedShareOutcome(market.questionOutcome)
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

/** Local settlement intent, with the displayed minimum retained through fresh validation. */
export type SettlementApproval =
	| Readonly<{ operation: 'redeem-complete-set'; market: LiveMarket; amount: bigint; deadline: TransactionExpiry; slippageBps: bigint; expectedAttoEth: bigint; minimumAttoEth: bigint }>
	| Readonly<{ operation: 'redeem-winning-shares'; market: LiveMarket }>
	| Readonly<{ operation: 'migrate-shares'; market: LiveMarket; sourceOutcome: ShareOutcome; targetOutcomeIndexes: readonly bigint[] }>

export async function submitFreshSettlement(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: SettlementApproval, guardedWrite: GuardedWalletWrite): Promise<Hash> {
	let parameters: Readonly<{ amount?: bigint; deadline?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> = {}
	if (quote.operation === 'redeem-complete-set') parameters = { amount: quote.amount, ...(typeof quote.deadline === 'bigint' ? { deadline: quote.deadline } : quote.deadline), slippageBps: quote.slippageBps }
	else if (quote.operation === 'migrate-shares') parameters = { sourceOutcome: quote.sourceOutcome, targetOutcomeIndexes: quote.targetOutcomeIndexes }
	const refreshed = await simulateSettlement(client, configuration, quote.market, account, quote.operation, parameters)
	if (quote.operation === 'redeem-complete-set') {
		if (refreshed.operation !== 'redeem-complete-set') throw new Error('Settlement operation changed during revalidation')
		const minimumEth = retainApprovedMinimum(quote.minimumAttoEth, refreshed.expectedAttoEth, 'ETH output')
		const invalidTokenId = quote.market.universeId << 8n
		const data = encodeReceiveBasedRedeemRequest(quote.market, quote.amount, minimumEth, account, refreshed.deadline)
		return await guardedWrite(async () => {
			const block = await latestBlockIdentity(client)
			if (block.blockTimestamp >= refreshed.deadline) throw new Error('Transaction deadline has passed; simulate again')
			const feeMarket = await loadTransactionFeeMarket(client, quote.market, block.blockNumber, block.blockTimestamp)
			const feeBlocker = sellHoldingFeeBlocker(feeMarket, quote.amount, minimumEth, refreshed.deadline)
			if (feeBlocker !== undefined) throw new Error(feeBlocker)
			return await client.writeContract({ abi: shareTokenAbi, address: quote.market.shareToken, functionName: 'safeBatchTransferFrom', account, args: [account, shareOperationRouter(configuration), [invalidTokenId, invalidTokenId | 1n, invalidTokenId | 2n], [quote.amount, quote.amount, quote.amount], data] })
		})
	}
	if (quote.operation === 'redeem-winning-shares') return await guardedWrite(async () => await client.writeContract({ abi: securityPoolAbi, address: quote.market.pool, functionName: 'redeemShares', account, args: [] }))
	if (refreshed.operation !== 'migrate-shares') throw new Error('Settlement operation changed during revalidation')
	const sourceTokenId = (quote.market.universeId << 8n) | outcomeValue(refreshed.sourceOutcome)
	return await guardedWrite(async () => await client.writeContract({ abi: shareTokenAbi, address: quote.market.shareToken, functionName: 'migrate', account, args: [sourceTokenId, refreshed.targetOutcomeIndexes] }))
}
