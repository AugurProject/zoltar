import type { Address, Hash, WalletClient } from '@zoltar/shared/ethereum'
import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-core-shared/contractArtifact.js'
import { tradingContracts } from '../generated/contractArtifact.js'
import { capabilitiesForTradingVersion } from '@zoltar/ui-trading-domain/capabilities.js'
import type { DeploymentConfiguration } from './config.js'
import type { LiveBalances, LiveMarket, MarketLifecycle } from './liveMarket.js'
import { deadlineAtBlock, minimumAfterSlippage, requireQuoteBlock, requireTransactionSlippageBps, requireTransactionValidityMinutes, retainApprovedMinimum, stableSimulation, UI_SLIPPAGE_BPS, type TransactionExpiry } from './tradeQuote.js'
import { configuredShareOperationRouter, encodeReceiveBasedRedeemRequest, shareTokenAbi } from './versionedAuthorization.js'

const securityPoolAbi = statoblast_SecurityPool_SecurityPool.abi
const router = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter

export type SettlementOperation = 'redeem-complete-set' | 'redeem-winning-shares' | 'migrate-shares'
export type ShareOutcome = 'INVALID' | 'YES' | 'NO'
type GuardedWalletWrite = <T>(write: () => Promise<T>) => Promise<T>

function outcomeValue(outcome: ShareOutcome) {
	if (outcome === 'INVALID') return 0n
	return outcome === 'YES' ? 1n : 2n
}

export function normalizeForkOutcomeIndexes(targetOutcomeIndexes: readonly bigint[]) {
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

export function settlementAvailability(market: MarketLifecycle, balances: Pick<LiveBalances, 'invalid' | 'yes' | 'no'> | undefined) {
	const completeSets = balances === undefined ? 0n : [balances.invalid, balances.yes, balances.no].reduce((minimum, balance) => (balance < minimum ? balance : minimum))
	let winningBalance = 0n
	if (balances !== undefined) {
		if (market.questionOutcome === 0) winningBalance = balances.invalid
		else if (market.questionOutcome === 1) winningBalance = balances.yes
		else if (market.questionOutcome === 2) winningBalance = balances.no
	}
	const directionalBalance = balances === undefined ? 0n : balances.invalid + balances.yes + balances.no
	return {
		completeSets,
		winningBalance,
		canRedeemCompleteSets: market.loadError === undefined && market.systemState === 0 && market.universeForkTime === 0n && completeSets > 0n,
		canRedeemWinningShares: market.loadError === undefined && market.systemState === 0 && market.questionOutcome !== 3 && winningBalance > 0n,
		canMigrateShares: market.loadError === undefined && market.universeForkTime !== 0n && directionalBalance > 0n,
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
			result: { simulation, deadline },
		} = await stableSimulation(client, async block => {
			const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
			if (capabilitiesForTradingVersion(configuration.version).receiveBasedShareOperations) {
				const invalidTokenId = market.universeId << 8n
				const estimatedEthOut = market.shareTokenSupplyAttoShares === 0n ? 0n : (amount * market.settlementCollateralAttoEth) / market.shareTokenSupplyAttoShares
				const minimumEth = minimumAfterSlippage(estimatedEthOut, slippageBps)
				const data = encodeReceiveBasedRedeemRequest(market, amount, minimumEth, account, deadline)
				const simulation = await client.simulateContract({
					abi: shareTokenAbi,
					address: market.shareToken,
					functionName: 'safeBatchTransferFrom',
					account,
					args: [account, configuredShareOperationRouter(configuration), [invalidTokenId, invalidTokenId | 1n, invalidTokenId | 2n], [amount, amount, amount], data],
					blockHash: block.blockHash,
				})
				void simulation
				return { simulation: { result: estimatedEthOut }, deadline }
			}
			const simulation = await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'redeemCompleteSet', account, args: [market.pool, amount, 0n, account, deadline], blockHash: block.blockHash })
			return { simulation, deadline }
		})
		if (simulation.result <= 0n) throw new Error('Complete-set redemption would return zero ETH')
		return { blockNumber, blockHash, operation, market, amount, deadline, slippageBps, expectedAttoEth: simulation.result, minimumAttoEth: minimumAfterSlippage(simulation.result, slippageBps) }
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
	await requireQuoteBlock(client, quote)
	let parameters: Readonly<{ amount?: bigint; deadline?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> = {}
	if (quote.operation === 'redeem-complete-set') parameters = { amount: quote.amount, deadline: quote.deadline, slippageBps: quote.slippageBps }
	else if (quote.operation === 'migrate-shares') parameters = { sourceOutcome: quote.sourceOutcome, targetOutcomeIndexes: quote.targetOutcomeIndexes }
	const refreshed = await simulateSettlementWithExpiryParameters(client, configuration, quote.market, account, quote.operation, parameters)
	if (refreshed.blockNumber !== quote.blockNumber || refreshed.blockHash !== quote.blockHash) throw new Error('Settlement changed blocks during revalidation')
	if (quote.operation === 'redeem-complete-set') {
		if (refreshed.operation !== 'redeem-complete-set') throw new Error('Settlement operation changed during revalidation')
		const minimumEth = retainApprovedMinimum(quote.minimumAttoEth, refreshed.expectedAttoEth, 'ETH output')
		if (capabilitiesForTradingVersion(configuration.version).receiveBasedShareOperations) {
			const invalidTokenId = quote.market.universeId << 8n
			const data = encodeReceiveBasedRedeemRequest(quote.market, quote.amount, minimumEth, account, quote.deadline)
			return await guardedWrite(
				async () =>
					await client.writeContract({ abi: shareTokenAbi, address: quote.market.shareToken, functionName: 'safeBatchTransferFrom', account, args: [account, configuredShareOperationRouter(configuration), [invalidTokenId, invalidTokenId | 1n, invalidTokenId | 2n], [quote.amount, quote.amount, quote.amount], data] }),
			)
		}
		return await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'redeemCompleteSet', account, args: [quote.market.pool, quote.amount, minimumEth, account, quote.deadline] }))
	}
	if (quote.operation === 'redeem-winning-shares') return await guardedWrite(async () => await client.writeContract({ abi: securityPoolAbi, address: quote.market.pool, functionName: 'redeemShares', account, args: [] }))
	const sourceTokenId = (quote.market.universeId << 8n) | outcomeValue(quote.sourceOutcome)
	return await guardedWrite(async () => await client.writeContract({ abi: shareTokenAbi, address: quote.market.shareToken, functionName: 'migrate', account, args: [sourceTokenId, quote.targetOutcomeIndexes] }))
}
