import { simulateLiquidity, type LiquidityOperation } from './liquiditySimulation.js'
import { requireFreshSubmissionWindow } from './submissionWindow.js'
import type { Address, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { tradingContracts } from '../generated/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import { loadTransactionFeeMarket, liquidityHoldingFeeBlocker } from './holdingFees.js'
import type { LiveMarket } from './liveMarket.js'
import { maximumAfterSlippage, minimumAfterSlippage, retainApprovedMaximum, retainApprovedMinimum, latestBlockIdentity, type GuardedWalletWrite, type TransactionExpiry } from './tradeQuote.js'

const pair = tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
const router = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
export type { LiquidityOperation } from './liquiditySimulation.js'

/** The amounts approved in the local preview; a relative expiry starts at submission. */
export type LiquidityApproval = Readonly<{
	market: LiveMarket
	operation: LiquidityOperation
	amount: bigint
	conditionalYesBps: bigint
	deadline: TransactionExpiry
	slippageBps: bigint
	expectedLiquidity: bigint
	expectedYes: bigint
	expectedNo: bigint
	expectedYesDeposit: bigint
	expectedNoDeposit: bigint
}>

export async function submitFreshLiquidity(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: LiquidityApproval, guardedWrite: GuardedWalletWrite) {
	const refreshed = await simulateLiquidity(client, configuration, quote.market, account, quote.operation, quote.amount, quote.conditionalYesBps, quote.deadline, quote.slippageBps)
	if (quote.operation === 'initialize') {
		const minimumLiquidity = retainApprovedMinimum(minimumAfterSlippage(quote.expectedLiquidity, quote.slippageBps), refreshed.expectedLiquidity, 'LP tokens')
		const initializedPairAddress = quote.market.pair
		return initializedPairAddress === undefined
			? await guardedWrite(async () => {
					await requireFreshSubmissionWindow(client, quote.market, quote.operation, refreshed.deadline)
					return await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'createPairAndInitializeWithEth', account, args: [quote.market.pool, quote.conditionalYesBps, minimumLiquidity, account, refreshed.deadline], value: quote.amount })
				})
			: await guardedWrite(async () => {
					await requireFreshSubmissionWindow(client, quote.market, quote.operation, refreshed.deadline)
					return await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'initializeWithEth', account, args: [initializedPairAddress, quote.conditionalYesBps, minimumLiquidity, account, refreshed.deadline], value: quote.amount })
				})
	}
	const pairAddress = quote.market.pair
	if (pairAddress === undefined) throw new Error('The trading pool disappeared while the transaction was checked')
	if (quote.operation === 'add') {
		if (refreshed.operation !== 'add') throw new Error('Liquidity operation changed during revalidation')
		const minimumLiquidity = retainApprovedMinimum(minimumAfterSlippage(quote.expectedLiquidity, quote.slippageBps), refreshed.expectedLiquidity, 'LP tokens')
		// Bound the deposit mix too: a swap toward even odds raises both the minority-side deposit and the minted LP.
		const maximumYes = retainApprovedMaximum(maximumAfterSlippage(quote.expectedYesDeposit, quote.slippageBps), refreshed.expectedYesDeposit, 'YES deposit')
		const maximumNo = retainApprovedMaximum(maximumAfterSlippage(quote.expectedNoDeposit, quote.slippageBps), refreshed.expectedNoDeposit, 'NO deposit')
		const block = await latestBlockIdentity(client)
		const feeMarket = await loadTransactionFeeMarket(client, quote.market, block.blockNumber, block.blockTimestamp)
		const feeBlocker = liquidityHoldingFeeBlocker(feeMarket, quote.amount, maximumYes, maximumNo, refreshed.deadline, refreshed.result)
		if (feeBlocker !== undefined) throw new Error(feeBlocker)
		return await guardedWrite(async () => {
			await requireFreshSubmissionWindow(client, quote.market, quote.operation, refreshed.deadline)
			return await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'addLiquidityWithEth', account, args: [pairAddress, maximumYes, maximumNo, minimumLiquidity, account, refreshed.deadline], value: quote.amount })
		})
	}
	const minimumYes = retainApprovedMinimum(minimumAfterSlippage(quote.expectedYes, quote.slippageBps), refreshed.expectedYes, 'YES')
	const minimumNo = retainApprovedMinimum(minimumAfterSlippage(quote.expectedNo, quote.slippageBps), refreshed.expectedNo, 'NO')
	return await guardedWrite(async () => await client.writeContract({ abi: pair.abi, address: pairAddress, functionName: 'removeLiquidity', account, args: [quote.amount, minimumYes, minimumNo, account, refreshed.deadline] }))
}
