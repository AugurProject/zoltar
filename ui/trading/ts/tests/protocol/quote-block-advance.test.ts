import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, decodeFunctionData, encodeAbiParameters, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { shareTokenAbi } from '../../protocol/authorization.js'
import { simulateEntry, simulateExit, simulateLiquidity, simulateSettlement, submitFreshEntry, submitFreshExit, submitFreshLiquidity, submitFreshSettlement, type LiveMarket } from '../../protocol/live.js'
import { tradingContracts } from '../../generated/contractArtifact.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const pair = `0x${'33'.repeat(20)}` as Address
const shareToken = `0x${'44'.repeat(20)}` as Address
const transactionHash = `0x${'66'.repeat(32)}` as Hex
const routerAbi = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter.abi
const pairAbi = tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair.abi
const configuration: DeploymentConfiguration = { chainId: 1, chainName: 'Test', rpcUrl: 'http://localhost', securityPoolFactory: `0x${'77'.repeat(20)}`, factory: `0x${'88'.repeat(20)}`, router: `0x${'99'.repeat(20)}`, feeBps: 30 }
const market: LiveMarket = {
	pool,
	pair,
	shareToken,
	universeId: 1n,
	questionId: 2n,
	title: 'Block advance',
	description: 'Quote block advance fixture',
	endTime: 2n ** 255n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 1n,
	systemState: 0,
	awaitingForkContinuation: false,
	universeForkTime: 0n,
	vaultCount: 1n,
	shareTokenSupplyAttoShares: 100n,
	settlementCollateralAttoEth: 100n,
	currentRetentionRate: 10n ** 18n,
	totalCapacityOwnershipAttoRep: 1n,
	feeEligibleCapacityOwnershipAttoRep: 1n,
	mintingCapacityCeilingAttoEth: 100n,
	availableMintingCapacityAttoEth: 100n,
	feeBps: 30n,
	tradingStatus: 0,
	questionOutcome: 3,
	yesReserve: 50n,
	noReserve: 50n,
	lpTotalSupply: 50n,
}
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
	const chain = { head: 2n, longSharesOut: 10n, sends: [] as Hex[], simulatedBlocks: [] as unknown[] }
	const client = createWalletClient({
		account,
		transport: custom({
			async request({ method, params }) {
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
				if (transaction.to === pool.toLowerCase()) return '0x'
				const decoded = decodeFunctionData({ abi: routerAbi, data: transaction.data })
				if (decoded.functionName === 'enterPosition') return encodeAbiParameters([{ type: 'tuple', components: [uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256] }], [[10n, 10n, 1n, 2n, chain.longSharesOut, 10n, 1n, 5_000n, 5_001n]])
				if (decoded.functionName === 'addLiquidityWithEth') return encodeAbiParameters([{ type: 'tuple', components: [address, uint256, uint256, uint256, uint256, uint256, uint256, uint256] }], [[pair, 10n, 5n, 5n, 5n, 5n, 10n, 10n]])
				throw new Error(`Unexpected simulation ${decoded.functionName}`)
			},
		}),
	})
	return { chain, client }
}

const write = async <T>(send: () => Promise<T>) => await send()

describe('submitting a quote after the chain advances', () => {
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
