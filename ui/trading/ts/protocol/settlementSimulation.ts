import type { Address, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import type { LiveMarket } from './liveMarket.js'
import type { SettlementOperation, ShareOutcome } from './settlement.js'
import { minimumAfterSlippage, requireTransactionSlippageBps, simulateWithDeadline, stableSimulation, UI_SLIPPAGE_BPS, type TransactionExpiry } from './tradeQuote.js'
import { encodeReceiveBasedRedeemRequest, shareOperationRouter, shareTokenAbi } from './authorization.js'
import { loadTransactionFeeMarket, sellHoldingFeeBlocker } from './holdingFees.js'
const securityPoolAbi = statoblast_SecurityPool_SecurityPool.abi

export function outcomeValue(outcome: ShareOutcome) {
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

export async function simulateSettlement(
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
			const feeMarket = await loadTransactionFeeMarket(client, market, block.blockNumber, block.blockTimestamp)
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
				blockNumber: block.blockNumber,
			})
			void simulation
			return { result: estimatedEthOut, feeMarket }
		})
		if (simulation.result <= 0n) throw new Error('Complete-set redemption would return zero ETH')
		return { blockNumber, blockHash, operation, market: simulation.feeMarket, amount, deadline, slippageBps, expectedAttoEth: simulation.result, minimumAttoEth: minimumAfterSlippage(simulation.result, slippageBps) }
	}
	if (operation === 'redeem-winning-shares') {
		const { blockNumber, blockHash } = await stableSimulation(client, async block => await client.simulateContract({ abi: securityPoolAbi, address: market.pool, functionName: 'redeemShares', account, args: [], blockNumber: block.blockNumber }))
		return { blockNumber, blockHash, operation, market }
	}
	if (parameters.sourceOutcome === undefined || parameters.targetOutcomeIndexes === undefined) throw new Error('Select a source share and at least one fork target')
	const sourceOutcome = parameters.sourceOutcome
	const targetOutcomeIndexes = normalizeForkOutcomeIndexes(parameters.targetOutcomeIndexes)
	const sourceTokenId = (market.universeId << 8n) | outcomeValue(sourceOutcome)
	const { blockNumber, blockHash } = await stableSimulation(client, async block => await client.simulateContract({ abi: shareTokenAbi, address: market.shareToken, functionName: 'migrate', account, args: [sourceTokenId, targetOutcomeIndexes], blockNumber: block.blockNumber }))
	return { blockNumber, blockHash, operation, market, sourceOutcome, targetOutcomeIndexes }
}
