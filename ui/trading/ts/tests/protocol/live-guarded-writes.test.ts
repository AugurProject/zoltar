import { describe, expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, custom, decodeFunctionData, encodeAbiParameters, type Address, type Hex } from '@zoltar/shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { createTradingPublicClient, simulateEntry, simulateExit, simulateLiquidity, submitFreshEntry, submitFreshExit, submitFreshLiquidity, type LiveMarket } from '../../protocol/live.js'
import { tradingContracts } from '../../generated/contractArtifact.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const pair = `0x${'33'.repeat(20)}` as Address
const shareToken = `0x${'44'.repeat(20)}` as Address
const blockHash = `0x${'55'.repeat(32)}` as Hex
const transactionHash = `0x${'66'.repeat(32)}` as Hex
const routerAbi = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter.abi
const pairAbi = tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair.abi
const receiveRequestParameter = {
	type: 'tuple',
	components: [
		{ name: 'version', type: 'uint8' },
		{ name: 'operation', type: 'uint8' },
		{ name: 'shareToken', type: 'address' },
		{ name: 'securityPool', type: 'address' },
		{ name: 'pair', type: 'address' },
		{ name: 'universeId', type: 'uint248' },
		{ name: 'questionId', type: 'uint256' },
		{ name: 'invalidTokenId', type: 'uint256' },
		{ name: 'yesTokenId', type: 'uint256' },
		{ name: 'noTokenId', type: 'uint256' },
		{ name: 'longOutcome', type: 'uint8' },
		{ name: 'completeSetShares', type: 'uint256' },
		{ name: 'maxLongSharesIn', type: 'uint256' },
		{ name: 'minEthOut', type: 'uint256' },
		{ name: 'payoutRecipient', type: 'address' },
		{ name: 'refundRecipient', type: 'address' },
		{ name: 'deadline', type: 'uint256' },
	],
} as const
const shareTransferAbi = [
	{
		type: 'function',
		name: 'safeBatchTransferFrom',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'from', type: 'address' },
			{ name: 'to', type: 'address' },
			{ name: 'ids', type: 'uint256[]' },
			{ name: 'values', type: 'uint256[]' },
			{ name: 'data', type: 'bytes' },
		],
		outputs: [],
	},
] as const
const configuration: DeploymentConfiguration = { chainId: 1, chainName: 'Test', rpcUrl: 'http://localhost', securityPoolFactory: `0x${'77'.repeat(20)}`, factory: `0x${'88'.repeat(20)}`, router: `0x${'99'.repeat(20)}`, feeBps: 30 }
const market: LiveMarket = {
	pool,
	pair,
	shareToken,
	universeId: 1n,
	questionId: 2n,
	title: 'Guarded writes',
	description: 'Wallet context fixture',
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

function callData(params: unknown) {
	if (!Array.isArray(params)) throw new Error('RPC parameters must be an array')
	const transaction: unknown = params[0]
	if (typeof transaction !== 'object' || transaction === null || !('data' in transaction) || typeof transaction.data !== 'string') throw new Error('RPC transaction must contain data')
	return transaction.data as Hex
}

test('creates live read clients from the configured active backend', () => {
	const configuredClient = createPublicClient({ transport: custom({ request: async () => '0x1' }) })
	const backend = { ...createFakeBackend(), createReadClient: () => configuredClient }
	const restoreEnvironment = installActiveEnvironmentForTesting(backend)
	try {
		expect(createTradingPublicClient(configuration)).toBe(configuredClient)
	} finally {
		restoreEnvironment()
	}
})

describe('live guarded transaction writes', () => {
	test('simulates and submits the exact same final receive-based exit payload', async () => {
		const shareCalls: Hex[] = []
		const client = createWalletClient({
			account,
			transport: custom({
				async request({ method, params }) {
					if (method === 'eth_blockNumber') return '0x2'
					if (method === 'eth_getBlockByNumber') return { hash: blockHash, number: '0x2', parentHash: `0x${'aa'.repeat(32)}`, timestamp: '0x1', transactions: [] }
					if ((method === 'eth_call' || method === 'eth_sendTransaction') && Array.isArray(params)) {
						const transaction = params[0]
						if (typeof transaction !== 'object' || transaction === null || !('to' in transaction) || !('data' in transaction) || typeof transaction.to !== 'string' || typeof transaction.data !== 'string') throw new Error('Malformed transaction')
						if (transaction.to.toLowerCase() === pair.toLowerCase()) return encodeAbiParameters([uint256, uint256], [2n, 1n])
						if (transaction.to.toLowerCase() !== shareToken.toLowerCase()) throw new Error('Unexpected transaction target')
						shareCalls.push(transaction.data as Hex)
						return method === 'eth_sendTransaction' ? transactionHash : '0x'
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			}),
		})
		const quote = await simulateExit(client, configuration, market, account, 'YES', 10n, 7n, 500n)
		expect(quote.maximumLongShares).toBe(13n)
		expect(quote.minimumEth).toBe(9n)
		expect(await submitFreshExit(client, configuration, account, quote, async write => await write())).toBe(transactionHash)
		expect(shareCalls).toHaveLength(3)
		expect(shareCalls[1]).toBe(shareCalls[0])
		expect(shareCalls[2]).toBe(shareCalls[0])
		const decodedTransfer = decodeFunctionData({ abi: shareTransferAbi, data: shareCalls[0] })
		if (decodedTransfer.args === undefined) throw new Error('Missing share transfer arguments')
		expect(decodedTransfer.args[4]).toBe(encodeAbiParameters([receiveRequestParameter], [[1, 0, shareToken, pool, pair, 1n, 2n, 256n, 257n, 258n, 1, 10n, quote.maximumLongShares, quote.minimumEth, account, account, quote.deadline]]))
	})

	test('uses one approved deadline for liquidity simulation, revalidation, and submission', async () => {
		const calls: ReturnType<typeof decodeFunctionData>[] = []
		const client = createWalletClient({
			account,
			transport: custom({
				async request({ method, params }) {
					if (method === 'eth_blockNumber') return '0x2'
					if (method === 'eth_getBlockByNumber') return { hash: blockHash, number: '0x2', parentHash: `0x${'aa'.repeat(32)}`, timestamp: '0x1', transactions: [] }
					if (method === 'eth_call' || method === 'eth_sendTransaction') {
						const decoded = decodeFunctionData({ abi: [...routerAbi, ...pairAbi], data: callData(params) })
						calls.push(decoded)
						if (method === 'eth_sendTransaction') return transactionHash
						if (decoded.functionName === 'removeLiquidity') return encodeAbiParameters([uint256, uint256], [5n, 5n])
						return encodeAbiParameters([{ type: 'tuple', components: [address, uint256, uint256, uint256, uint256, uint256, uint256, uint256] }], [[pair, 10n, 5n, 5n, 5n, 5n, 10n, 10n]])
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			}),
		})
		const validityMinutes = 7n
		const deadline = 421n
		const slippageBps = 500n
		const operations = [
			{ operation: 'initialize', market: { ...market, pair: undefined } },
			{ operation: 'initialize', market },
			{ operation: 'add', market },
			{ operation: 'remove', market },
		] as const
		for (const scenario of operations) {
			const quote = await simulateLiquidity(client, configuration, scenario.market, account, scenario.operation, 10n, 5_000n, validityMinutes, slippageBps)
			expect(quote.deadline).toBe(deadline)
			expect(quote.slippageBps).toBe(slippageBps)
			expect(await submitFreshLiquidity(client, configuration, account, quote, async write => await write())).toBe(transactionHash)
		}

		expect(calls).toHaveLength(12)
		for (const call of calls) {
			if (call.args === undefined) throw new Error('Expected decoded liquidity arguments')
			expect(call.args.at(-1)).toBe(deadline)
		}
		for (const call of calls.filter((_, index) => index % 3 === 2)) {
			if (call.args === undefined) throw new Error('Expected decoded submitted liquidity arguments')
			if (call.functionName === 'removeLiquidity') {
				expect(call.args[1]).toBe(4n)
				expect(call.args[2]).toBe(4n)
			} else expect(call.args.at(-3)).toBe(9n)
		}
		const chainTimedQuote = await simulateLiquidity(client, configuration, market, account, 'add', 10n, 5_000n, 1_440n, slippageBps)
		expect(chainTimedQuote.deadline).toBe(86_401n)
		expect(await submitFreshLiquidity(client, configuration, account, chainTimedQuote, async write => await write())).toBe(transactionHash)
		for (const call of calls.slice(-3)) {
			if (call.args === undefined) throw new Error('Expected decoded chain-timed liquidity arguments')
			expect(call.args.at(-1)).toBe(86_401n)
		}
		const callsBeforeRejectedSlippage = calls.length
		await expect(simulateLiquidity(client, configuration, market, account, 'add', 10n, 5_000n, validityMinutes, 501n)).rejects.toThrow('between 0% and 5%')
		await expect(simulateLiquidity(client, configuration, market, account, 'add', 10n, 5_000n, 0n, slippageBps)).rejects.toThrow('between 1 and 1440 minutes')
		await expect(simulateLiquidity(client, configuration, market, account, 'add', 10n, 5_000n, 1_441n, slippageBps)).rejects.toThrow('between 1 and 1440 minutes')
		expect(calls).toHaveLength(callsBeforeRejectedSlippage)
	})

	test('checks the wallet context after entry, exit, and liquidity revalidation and before every broadcast', async () => {
		let sends = 0
		const client = createWalletClient({
			account,
			transport: custom({
				async request({ method, params }) {
					if (method === 'eth_blockNumber') return '0x2'
					if (method === 'eth_getBlockByNumber') return { hash: blockHash, number: '0x2', parentHash: `0x${'aa'.repeat(32)}`, timestamp: '0x1', transactions: [] }
					if (method === 'eth_call') {
						const transaction = Array.isArray(params) ? params[0] : undefined
						const target = typeof transaction === 'object' && transaction !== null && 'to' in transaction && typeof transaction.to === 'string' ? transaction.to.toLowerCase() : ''
						if (target === pair.toLowerCase()) return encodeAbiParameters([uint256, uint256], [2n, 1n])
						if (target === shareToken.toLowerCase()) return '0x'
						const decoded = decodeFunctionData({ abi: routerAbi, data: callData(params) })
						if (decoded.functionName === 'enterPosition') return encodeAbiParameters([{ type: 'tuple', components: [uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256] }], [[10n, 10n, 1n, 2n, 12n, 10n, 1n, 5_000n, 5_001n]])
						if (decoded.functionName === 'addLiquidityWithEth') return encodeAbiParameters([{ type: 'tuple', components: [address, uint256, uint256, uint256, uint256, uint256, uint256, uint256] }], [[pair, 10n, 5n, 5n, 5n, 5n, 10n, 10n]])
						throw new Error(`Unexpected simulation ${decoded.functionName}`)
					}
					if (method === 'eth_sendTransaction') {
						sends++
						return transactionHash
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			}),
		})
		const validityMinutes = 7n
		const slippageBps = 500n
		const entry = await simulateEntry(client, configuration, market, account, 'YES', 10n, validityMinutes, slippageBps)
		const exit = await simulateExit(client, configuration, market, account, 'YES', 10n, validityMinutes, slippageBps)
		const liquidity = await simulateLiquidity(client, configuration, market, account, 'add', 10n)
		let guards = 0
		const rejectChangedContext = async () => {
			guards++
			throw new Error('Wallet context changed during transaction revalidation')
		}
		await expect(submitFreshEntry(client, configuration, account, entry, rejectChangedContext)).rejects.toThrow('Wallet context changed during transaction revalidation')
		await expect(submitFreshExit(client, configuration, account, exit, rejectChangedContext)).rejects.toThrow('Wallet context changed during transaction revalidation')
		await expect(submitFreshLiquidity(client, configuration, account, liquidity, rejectChangedContext)).rejects.toThrow('Wallet context changed during transaction revalidation')
		expect(guards).toBe(3)
		expect(sends).toBe(0)
	})
})
