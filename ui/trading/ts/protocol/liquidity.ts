import { submissionDeadline, requireFreshSubmissionWindow } from './submissionWindow.js'
import { maxUint256, type Address, type WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { tradingContracts } from '../generated/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import { loadTransactionFeeMarket, liquidityHoldingFeeBlocker } from './holdingFees.js'
import type { LiveMarket } from './liveMarket.js'
import { maximumAfterSlippage, minimumAfterSlippage, requireTransactionSlippageBps, requireTransactionValidityMinutes, retainApprovedMaximum, retainApprovedMinimum, latestBlockIdentity, simulateWithDeadline, UI_SLIPPAGE_BPS, type GuardedWalletWrite, type TransactionExpiry } from './tradeQuote.js'

const pair = tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
const router = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
export type LiquidityOperation = 'initialize' | 'add' | 'remove'

async function simulateLiquidityWithExpiry(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, operation: LiquidityOperation, amount: bigint, conditionalYesBps: bigint, expiry: TransactionExpiry, slippageBps: bigint) {
	requireTransactionSlippageBps(slippageBps)
	const pairAddress = market.pair
	if (operation === 'initialize') {
		const {
			blockNumber,
			blockHash,
			deadline,
			result: simulation,
		} = await simulateWithDeadline(
			client,
			expiry,
			async (block, deadline) =>
				pairAddress === undefined
					? await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'createPairAndInitializeWithEth', account, args: [market.pool, conditionalYesBps, 0n, account, deadline], value: amount, blockHash: block.blockHash })
					: await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'initializeWithEth', account, args: [pairAddress, conditionalYesBps, 0n, account, deadline], value: amount, blockHash: block.blockHash }),
			(block, deadline) => submissionDeadline(client, market, operation, block, deadline),
		)
		return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: simulation.result.liquidity, expectedYes: 0n, expectedNo: 0n, expectedYesDeposit: 0n, expectedNoDeposit: 0n }
	}
	if (pairAddress === undefined) throw new Error('Pair is unavailable')
	if (operation === 'add') {
		const {
			blockNumber,
			blockHash,
			deadline,
			result: simulation,
		} = await simulateWithDeadline(
			client,
			expiry,
			async (block, deadline) => {
				const simulation = await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'addLiquidityWithEth', account, args: [pairAddress, maxUint256, maxUint256, 0n, account, deadline], value: amount, blockHash: block.blockHash })
				const feeMarket = await loadTransactionFeeMarket(client, market, block.blockHash, block.blockTimestamp)
				const feeBlocker = liquidityHoldingFeeBlocker(feeMarket, amount, maximumAfterSlippage(simulation.result.yesUsed, slippageBps), maximumAfterSlippage(simulation.result.noUsed, slippageBps), deadline, simulation.result)
				if (feeBlocker !== undefined) throw new Error(feeBlocker)
				return simulation
			},
			(block, deadline) => submissionDeadline(client, market, operation, block, deadline),
		)
		return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: simulation.result.liquidity, expectedYes: 0n, expectedNo: 0n, expectedYesDeposit: simulation.result.yesUsed, expectedNoDeposit: simulation.result.noUsed }
	}
	const {
		blockNumber,
		blockHash,
		deadline,
		result: simulation,
	} = await simulateWithDeadline(client, expiry, async (block, deadline) => await client.simulateContract({ abi: pair.abi, address: pairAddress, functionName: 'removeLiquidity', account, args: [amount, 0n, 0n, account, deadline], blockHash: block.blockHash }))
	return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: 0n, expectedYes: simulation.result[0], expectedNo: simulation.result[1], expectedYesDeposit: 0n, expectedNoDeposit: 0n }
}

export async function simulateLiquidity(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, operation: LiquidityOperation, amount: bigint, conditionalYesBps = 5_000n, validityMinutes = 20n, slippageBps = UI_SLIPPAGE_BPS) {
	requireTransactionValidityMinutes(validityMinutes)
	return await simulateLiquidityWithExpiry(client, configuration, market, account, operation, amount, conditionalYesBps, { validityMinutes }, slippageBps)
}

export async function submitFreshLiquidity(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: Awaited<ReturnType<typeof simulateLiquidity>>, guardedWrite: GuardedWalletWrite) {
	const refreshed = await simulateLiquidityWithExpiry(client, configuration, quote.market, account, quote.operation, quote.amount, quote.conditionalYesBps, quote.deadline, quote.slippageBps)
	if (quote.operation === 'initialize') {
		const minimumLiquidity = retainApprovedMinimum(minimumAfterSlippage(quote.expectedLiquidity, quote.slippageBps), refreshed.expectedLiquidity, 'LP tokens')
		const initializedPairAddress = quote.market.pair
		return initializedPairAddress === undefined
			? await guardedWrite(async () => {
					await requireFreshSubmissionWindow(client, quote.market, quote.operation, quote.deadline)
					return await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'createPairAndInitializeWithEth', account, args: [quote.market.pool, quote.conditionalYesBps, minimumLiquidity, account, quote.deadline], value: quote.amount })
				})
			: await guardedWrite(async () => {
					await requireFreshSubmissionWindow(client, quote.market, quote.operation, quote.deadline)
					return await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'initializeWithEth', account, args: [initializedPairAddress, quote.conditionalYesBps, minimumLiquidity, account, quote.deadline], value: quote.amount })
				})
	}
	const pairAddress = quote.market.pair
	if (pairAddress === undefined) throw new Error('Pair disappeared from the simulated market')
	if (quote.operation === 'add') {
		if (refreshed.operation !== 'add') throw new Error('Liquidity operation changed during revalidation')
		const minimumLiquidity = retainApprovedMinimum(minimumAfterSlippage(quote.expectedLiquidity, quote.slippageBps), refreshed.expectedLiquidity, 'LP tokens')
		// Bound the deposit mix too: a swap toward even odds raises both the minority-side deposit and the minted LP.
		const maximumYes = retainApprovedMaximum(maximumAfterSlippage(quote.expectedYesDeposit, quote.slippageBps), refreshed.expectedYesDeposit, 'YES deposit')
		const maximumNo = retainApprovedMaximum(maximumAfterSlippage(quote.expectedNoDeposit, quote.slippageBps), refreshed.expectedNoDeposit, 'NO deposit')
		const block = await latestBlockIdentity(client)
		const feeMarket = await loadTransactionFeeMarket(client, quote.market, block.blockHash, block.blockTimestamp)
		const feeBlocker = liquidityHoldingFeeBlocker(feeMarket, quote.amount, maximumYes, maximumNo, quote.deadline, refreshed.result)
		if (feeBlocker !== undefined) throw new Error(feeBlocker)
		return await guardedWrite(async () => {
			await requireFreshSubmissionWindow(client, quote.market, quote.operation, quote.deadline)
			return await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'addLiquidityWithEth', account, args: [pairAddress, maximumYes, maximumNo, minimumLiquidity, account, quote.deadline], value: quote.amount })
		})
	}
	const minimumYes = retainApprovedMinimum(minimumAfterSlippage(quote.expectedYes, quote.slippageBps), refreshed.expectedYes, 'YES')
	const minimumNo = retainApprovedMinimum(minimumAfterSlippage(quote.expectedNo, quote.slippageBps), refreshed.expectedNo, 'NO')
	return await guardedWrite(async () => await client.writeContract({ abi: pair.abi, address: pairAddress, functionName: 'removeLiquidity', account, args: [quote.amount, minimumYes, minimumNo, account, quote.deadline] }))
}
