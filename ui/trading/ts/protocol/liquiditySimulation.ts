import { submissionDeadline } from './submissionWindow.js'
import { maxUint256, type Address, type WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { tradingContracts } from '../generated/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import { loadTransactionFeeMarket, liquidityHoldingFeeBlocker } from './holdingFees.js'
import type { LiveMarket } from './liveMarket.js'
import { maximumAfterSlippage, requireTransactionSlippageBps, simulateWithDeadline, UI_SLIPPAGE_BPS, type TransactionExpiry } from './tradeQuote.js'

const pair = tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
const router = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
export type LiquidityOperation = 'initialize' | 'add' | 'remove'

export async function simulateLiquidity(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, operation: LiquidityOperation, amount: bigint, conditionalYesBps = 5_000n, expiry: TransactionExpiry = { validityMinutes: 20n }, slippageBps = UI_SLIPPAGE_BPS) {
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
					? await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'createPairAndInitializeWithEth', account, args: [market.pool, conditionalYesBps, 0n, account, deadline], value: amount, blockNumber: block.blockNumber })
					: await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'initializeWithEth', account, args: [pairAddress, conditionalYesBps, 0n, account, deadline], value: amount, blockNumber: block.blockNumber }),
			(block, deadline) => submissionDeadline(client, market, operation, block, deadline),
		)
		return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: simulation.result.liquidity, expectedYes: 0n, expectedNo: 0n, expectedYesDeposit: 0n, expectedNoDeposit: 0n }
	}
	if (pairAddress === undefined) throw new Error('The trading pool is unavailable')
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
				const simulation = await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'addLiquidityWithEth', account, args: [pairAddress, maxUint256, maxUint256, 0n, account, deadline], value: amount, blockNumber: block.blockNumber })
				const feeMarket = await loadTransactionFeeMarket(client, market, block.blockNumber, block.blockTimestamp)
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
	} = await simulateWithDeadline(client, expiry, async (block, deadline) => await client.simulateContract({ abi: pair.abi, address: pairAddress, functionName: 'removeLiquidity', account, args: [amount, 0n, 0n, account, deadline], blockNumber: block.blockNumber }))
	return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: 0n, expectedYes: simulation.result[0], expectedNo: simulation.result[1], expectedYesDeposit: 0n, expectedNoDeposit: 0n }
}
