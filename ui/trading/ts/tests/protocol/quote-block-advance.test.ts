import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, decodeFunctionData, encodeAbiParameters, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { shareTokenAbi } from '../../protocol/authorization.js'
import { simulateEntry, simulateExit, simulateLiquidity, simulateSettlement, submitFreshEntry, submitFreshExit, submitFreshLiquidity, submitFreshSettlement } from '../../protocol/live.js'
import { tradingContracts } from '../../generated/contractArtifact.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { feeAccountingRpcResult } from '../support/feeAccountingRpc.js'
import type { LiveMarket } from '../../protocol/liveMarket.js'
import { smallReserveMarketFixture } from '../support/liveMarketFixture.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const pair = `0x${'33'.repeat(20)}` as Address
const shareToken = `0x${'44'.repeat(20)}` as Address
const transactionHash = `0x${'66'.repeat(32)}` as Hex
const routerAbi = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter.abi
const pairAbi = tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair.abi
const configuration = deploymentConfigurationFixture({ chainId: 1, chainName: 'Test', rpcUrl: 'http://localhost', factory: `0x${'88'.repeat(20)}`, router: `0x${'99'.repeat(20)}` })
const market = smallReserveMarketFixture({ pool, pair, shareToken, title: 'Block advance', description: 'Quote block advance fixture' })
const uint256 = { type: 'uint256' } as const
const address = { type: 'address' } as const

function blockHashAt(blockNumber: bigint) {
	return `0x${blockNumber.toString(16).padStart(64, '0')}` as Hex
}

function transactionOf(params: unknown) {
	if (!Array.isArray(params)) throw new Error('RPC parameters must be an array')
	const transaction: unknown = params[0]
	if (typeof transaction !== 'object' || transaction === null || !('to' in transaction) || !('data' in transaction) || typeof transaction.to !== 'string' || typeof transaction.data !== 'string') throw new Error('Malformed transaction')
	return { to: transaction.to.toLowerCase(), data: transaction.data as Hex }
}

// A chain whose head advances on demand; `longSharesOut` lets a test move the price between blocks.
function createAdvancingChain() {
	const chain: { head: bigint; feeMarket: LiveMarket; longSharesOut: bigint; sends: Hex[]; simulatedBlocks: unknown[] } = { head: 2n, feeMarket: market, longSharesOut: 10n, sends: [], simulatedBlocks: [] }
	const client = createWalletClient({
		account,
		transport: custom({
			async request({ method, params }) {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_blockNumber') return `0x${chain.head.toString(16)}`
				if (method === 'eth_getBlockByNumber') return { hash: blockHashAt(chain.head), number: `0x${chain.head.toString(16)}`, parentHash: blockHashAt(chain.head - 1n), timestamp: `0x${chain.head.toString(16)}`, transactions: [] }
				if (method === 'eth_sendTransaction') {
					chain.sends.push(transactionOf(params).data)
					return transactionHash
				}
				if (method !== 'eth_call') throw new Error(`Unexpected RPC method ${method}`)
				if (Array.isArray(params)) chain.simulatedBlocks.push(params[1])
				const transaction = transactionOf(params)
				if (transaction.to === pair.toLowerCase()) return decodeFunctionData({ abi: pairAbi, data: transaction.data }).functionName === 'removeLiquidity' ? encodeAbiParameters([uint256, uint256], [5n, 5n]) : encodeAbiParameters([uint256, uint256], [2n, 1n])
				if (transaction.to === shareToken.toLowerCase()) {
					const decoded = decodeFunctionData({ abi: shareTokenAbi, data: transaction.data })
					if (decoded.functionName === 'balanceOf') return encodeAbiParameters([uint256], [100n])
					if (decoded.functionName === 'safeBatchTransferFrom') return '0x'
					throw new Error(`Unexpected share token simulation ${decoded.functionName}`)
				}
				if (transaction.to === pool.toLowerCase()) return feeAccountingRpcResult(transaction.data, chain.feeMarket, chain.head) ?? '0x'
				const decoded = decodeFunctionData({ abi: routerAbi, data: transaction.data })
				if (decoded.functionName === 'enterPosition') return encodeAbiParameters([{ type: 'tuple', components: [uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256] }], [[10n, 10n, 1n, 2n, chain.longSharesOut, 10n, 1n, 5_000n, 5_001n]])
				if (decoded.functionName === 'addLiquidityWithEth' || decoded.functionName === 'initializeWithEth' || decoded.functionName === 'createPairAndInitializeWithEth')
					return encodeAbiParameters([{ type: 'tuple', components: [address, uint256, uint256, uint256, uint256, uint256, uint256, uint256] }], [[pair, 10n, 5n, 5n, 5n, 5n, 10n, 10n]])
				throw new Error(`Unexpected simulation ${decoded.functionName}`)
			},
		}),
	})
	return { chain, client }
}

const write = async <T>(send: () => Promise<T>) => await send()

describe('submitting a quote after the chain advances', () => {
	test('guards both cutoffs for entry, initialization, and addition with pinned fresh timing', async () => {
		for (const cutoff of ['question', 'oracle'] as const) {
			for (const remaining of [1n, 60n, 61n]) {
				for (const operation of ['entry', 'initialize', 'add'] as const) {
					const { chain, client } = createAdvancingChain()
					chain.head = 1000n
					chain.feeMarket = { ...market, ...(cutoff === 'question' ? { endTime: chain.head + remaining } : { oracleValidUntilTimestamp: chain.head + remaining }) }
					const pending = operation === 'entry' ? simulateEntry(client, configuration, market, account, 'YES', 10n) : simulateLiquidity(client, configuration, market, account, operation, 10n)
					if (remaining <= 60n) await expect(pending).rejects.toThrow('60 seconds')
					else expect((await pending).deadline).toBe(chain.head + remaining - 1n)
					expect(chain.sends).toHaveLength(0)
				}
			}
		}
	})
	test('rechecks each cutoff inside the final wallet guard without sending or loosening the deadline', async () => {
		for (const cutoff of ['question', 'oracle'] as const) {
			const { chain, client } = createAdvancingChain()
			chain.head = 1000n
			chain.feeMarket = { ...market, ...(cutoff === 'question' ? { endTime: chain.head + 61n } : { oracleValidUntilTimestamp: chain.head + 61n }) }
			const quote = await simulateEntry(client, configuration, market, account, 'YES', 10n)
			expect(quote.deadline).toBe(1060n)
			await expect(
				submitFreshEntry(client, configuration, account, quote, async send => {
					chain.head += 1n
					return await send()
				}),
			).rejects.toThrow('60 seconds')
			expect(chain.sends).toHaveLength(0)
		}
	})

	test('keeps liquidity removal available through close and stale oracle timing', async () => {
		const { chain, client } = createAdvancingChain()
		chain.feeMarket = { ...market, endTime: 1n, oracleValidUntilTimestamp: undefined }
		const quote = await simulateLiquidity(client, configuration, chain.feeMarket, account, 'remove', 1n)
		expect(await submitFreshLiquidity(client, configuration, account, quote, write)).toBe(transactionHash)
		expect(chain.sends).toHaveLength(1)
	})
	test('does not offer an add-liquidity quote whose deposit caps cannot cover holding fees', async () => {
		const { chain, client } = createAdvancingChain()
		const feeMarket = {
			...market,
			currentRetentionRate: 999_000_000_000_000_000n,
			valuation: {
				timestamp: 2n,
				feeEndTime: 1_000n,
				projectedCollateralAttoEth: 100n,
				feeAccounting: {
					settlementCollateralAttoEth: 100n,
					totalUnderwritingLimitAttoEth: 100n,
					feeEligibleUnderwritingLimitAttoEth: 100n,
					currentRetentionRate: 999_000_000_000_000_000n,
					lastUpdatedFeeAccumulator: 2n,
					feeIndexRemainder: 0n,
					totalFeesOwedRemainder: 0n,
				},
			},
		}
		chain.feeMarket = feeMarket
		await expect(simulateLiquidity(client, configuration, feeMarket, account, 'add', 10n, 5_000n, 7n, 0n)).rejects.toThrow('Holding fees')
		expect(chain.sends).toHaveLength(0)
	})

	test('reloads fee accounting after the user changes pool state and refuses unsafe approved bounds', async () => {
		for (const operation of ['sell', 'add'] as const) {
			const { chain, client } = createAdvancingChain()
			const quote = operation === 'sell' ? { kind: 'sell' as const, value: await simulateExit(client, configuration, market, account, 'YES', 10n, 7n, 0n) } : { kind: 'add' as const, value: await simulateLiquidity(client, configuration, market, account, 'add', 10n, 5_000n, 7n, 0n) }
			chain.feeMarket = { ...market, currentRetentionRate: 999_000_000_000_000_000n }
			const send = quote.kind === 'sell' ? submitFreshExit(client, configuration, account, quote.value, write) : submitFreshLiquidity(client, configuration, account, quote.value, write)
			await expect(send).rejects.toThrow('Holding fees')
			expect(chain.sends).toHaveLength(0)
		}
	})

	test('entry, exit, liquidity, and settlement revalidate at the new block and submit', async () => {
		const { chain, client } = createAdvancingChain()
		const entry = await simulateEntry(client, configuration, market, account, 'YES', 10n, 7n, 500n)
		const exit = await simulateExit(client, configuration, market, account, 'YES', 10n, 7n, 500n)
		const liquidity = await simulateLiquidity(client, configuration, market, account, 'add', 10n, 5_000n, 7n, 500n)
		const removal = await simulateLiquidity(client, configuration, market, account, 'remove', 10n, 5_000n, 7n, 500n)
		const settlement = await simulateSettlement(client, configuration, market, account, 'redeem-complete-set', { amount: 10n, validityMinutes: 7n, slippageBps: 500n })
		const winning = await simulateSettlement(client, configuration, market, account, 'redeem-winning-shares')

		chain.head = 3n
		chain.simulatedBlocks.length = 0
		expect(await submitFreshEntry(client, configuration, account, entry, write)).toBe(transactionHash)
		expect(await submitFreshExit(client, configuration, account, exit, write)).toBe(transactionHash)
		expect(await submitFreshLiquidity(client, configuration, account, liquidity, write)).toBe(transactionHash)
		expect(await submitFreshLiquidity(client, configuration, account, removal, write)).toBe(transactionHash)
		expect(await submitFreshSettlement(client, configuration, account, settlement, write)).toBe(transactionHash)
		expect(await submitFreshSettlement(client, configuration, account, winning, write)).toBe(transactionHash)
		expect(chain.sends).toHaveLength(6)
		expect(chain.simulatedBlocks.length).toBeGreaterThan(0)
		for (const block of chain.simulatedBlocks) expect(JSON.stringify(block)).toContain(blockHashAt(3n))
	})

	test('broadcasts the approved deadline and minimum after revalidating at a later block', async () => {
		const { chain, client } = createAdvancingChain()
		const entry = await simulateEntry(client, configuration, market, account, 'YES', 10n, 7n, 500n)
		chain.head = 9n
		chain.longSharesOut = 20n
		expect(await submitFreshEntry(client, configuration, account, entry, write)).toBe(transactionHash)
		expect(chain.sends).toHaveLength(1)
		const submitted = decodeFunctionData({ abi: routerAbi, data: chain.sends[0] ?? '0x' })
		expect(submitted.functionName).toBe('enterPosition')
		expect(submitted.args).toEqual([pair, 1n, 9n, account, 2n + 7n * 60n])
	})

	test('rejects a later-block quote that falls below the approved minimum without broadcasting', async () => {
		const { chain, client } = createAdvancingChain()
		const entry = await simulateEntry(client, configuration, market, account, 'YES', 10n, 7n, 500n)
		chain.head = 3n
		chain.longSharesOut = 8n
		await expect(submitFreshEntry(client, configuration, account, entry, write)).rejects.toThrow('approved minimum long shares')
		expect(chain.sends).toHaveLength(0)
	})
})
