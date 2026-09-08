import type { Address, WalletClient } from '@zoltar/shared/evm/ethereum'
import { tradingContracts } from '../generated/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import type { LiveMarket } from './liveMarket.js'
import { deadlineAtBlock, minimumAfterSlippage, requireQuoteBlock, requireTransactionSlippageBps, requireTransactionValidityMinutes, retainApprovedMinimum, stableSimulation, UI_SLIPPAGE_BPS, type TransactionExpiry } from './tradeQuote.js'

const pair = tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
const router = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
type GuardedWalletWrite = <T>(write: () => Promise<T>) => Promise<T>
export type LiquidityOperation = 'initialize' | 'add' | 'remove'

async function simulateLiquidityWithExpiry(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, operation: LiquidityOperation, amount: bigint, conditionalYesBps: bigint, expiry: TransactionExpiry, slippageBps: bigint) {
	requireTransactionSlippageBps(slippageBps)
	const pairAddress = market.pair
	if (operation === 'initialize') {
		const {
			blockNumber,
			blockHash,
			result: { simulation, deadline },
		} = await stableSimulation(client, async block => {
			const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
			const simulation =
				pairAddress === undefined
					? await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'createPairAndInitializeWithEth', account, args: [market.pool, conditionalYesBps, 0n, account, deadline], value: amount, blockHash: block.blockHash })
					: await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'initializeWithEth', account, args: [pairAddress, conditionalYesBps, 0n, account, deadline], value: amount, blockHash: block.blockHash })
			return { simulation, deadline }
		})
		return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: simulation.result.liquidity, expectedYes: 0n, expectedNo: 0n }
	}
	if (pairAddress === undefined) throw new Error('Pair is unavailable')
	if (operation === 'add') {
		const {
			blockNumber,
			blockHash,
			result: { simulation, deadline },
		} = await stableSimulation(client, async block => {
			const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
			const simulation = await client.simulateContract({ abi: router.abi, address: configuration.router, functionName: 'addLiquidityWithEth', account, args: [pairAddress, 0n, account, deadline], value: amount, blockHash: block.blockHash })
			return { simulation, deadline }
		})
		return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: simulation.result.liquidity, expectedYes: 0n, expectedNo: 0n }
	}
	const {
		blockNumber,
		blockHash,
		result: { simulation, deadline },
	} = await stableSimulation(client, async block => {
		const deadline = deadlineAtBlock(expiry, block.blockTimestamp)
		const simulation = await client.simulateContract({ abi: pair.abi, address: pairAddress, functionName: 'removeLiquidity', account, args: [amount, 0n, 0n, account, deadline], blockHash: block.blockHash })
		return { simulation, deadline }
	})
	return { blockNumber, blockHash, operation, amount, conditionalYesBps, deadline, slippageBps, market, result: simulation.result, expectedLiquidity: 0n, expectedYes: simulation.result[0], expectedNo: simulation.result[1] }
}

export async function simulateLiquidity(client: WalletClient, configuration: DeploymentConfiguration, market: LiveMarket, account: Address, operation: LiquidityOperation, amount: bigint, conditionalYesBps = 5_000n, validityMinutes = 20n, slippageBps = UI_SLIPPAGE_BPS) {
	requireTransactionValidityMinutes(validityMinutes)
	return await simulateLiquidityWithExpiry(client, configuration, market, account, operation, amount, conditionalYesBps, { validityMinutes }, slippageBps)
}

export async function submitFreshLiquidity(client: WalletClient, configuration: DeploymentConfiguration, account: Address, quote: Awaited<ReturnType<typeof simulateLiquidity>>, guardedWrite: GuardedWalletWrite) {
	await requireQuoteBlock(client, quote)
	const refreshed = await simulateLiquidityWithExpiry(client, configuration, quote.market, account, quote.operation, quote.amount, quote.conditionalYesBps, quote.deadline, quote.slippageBps)
	if (refreshed.blockNumber !== quote.blockNumber || refreshed.blockHash !== quote.blockHash) throw new Error('Quote changed blocks during revalidation')
	if (quote.operation === 'initialize') {
		const minimumLiquidity = retainApprovedMinimum(minimumAfterSlippage(quote.expectedLiquidity, quote.slippageBps), refreshed.expectedLiquidity, 'LP tokens')
		const initializedPairAddress = quote.market.pair
		return initializedPairAddress === undefined
			? await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'createPairAndInitializeWithEth', account, args: [quote.market.pool, quote.conditionalYesBps, minimumLiquidity, account, quote.deadline], value: quote.amount }))
			: await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'initializeWithEth', account, args: [initializedPairAddress, quote.conditionalYesBps, minimumLiquidity, account, quote.deadline], value: quote.amount }))
	}
	const pairAddress = quote.market.pair
	if (pairAddress === undefined) throw new Error('Pair disappeared from the simulated market')
	if (quote.operation === 'add') {
		const minimumLiquidity = retainApprovedMinimum(minimumAfterSlippage(quote.expectedLiquidity, quote.slippageBps), refreshed.expectedLiquidity, 'LP tokens')
		return await guardedWrite(async () => await client.writeContract({ abi: router.abi, address: configuration.router, functionName: 'addLiquidityWithEth', account, args: [pairAddress, minimumLiquidity, account, quote.deadline], value: quote.amount }))
	}
	const minimumYes = retainApprovedMinimum(minimumAfterSlippage(quote.expectedYes, quote.slippageBps), refreshed.expectedYes, 'YES')
	const minimumNo = retainApprovedMinimum(minimumAfterSlippage(quote.expectedNo, quote.slippageBps), refreshed.expectedNo, 'NO')
	return await guardedWrite(async () => await client.writeContract({ abi: pair.abi, address: pairAddress, functionName: 'removeLiquidity', account, args: [quote.amount, minimumYes, minimumNo, account, quote.deadline] }))
}
