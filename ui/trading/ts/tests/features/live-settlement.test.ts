import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, decodeFunctionData, decodeFunctionResult, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { settlementQuoteCanSubmit, settlementQuoteMatchesInputs } from '../../features/live/settlementQuote.js'
import { simulateSettlement, submitFreshSettlement, type LiveMarket } from '../../protocol/live.js'
import { receiveBasedExitArguments } from '../../protocol/authorization.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'

const account = `0x${'11'.repeat(20)}` as Address
const shareToken = `0x${'22'.repeat(20)}` as Address
const pool = `0x${'33'.repeat(20)}` as Address
const transactionHash = `0x${'44'.repeat(32)}` as Hex
const blockHash = `0x${'55'.repeat(32)}` as Hex
const configuration: DeploymentConfiguration = { chainId: 1, chainName: 'Test', rpcUrl: 'http://localhost', securityPoolFactory: `0x${'77'.repeat(20)}`, factory: `0x${'88'.repeat(20)}`, router: `0x${'99'.repeat(20)}`, feeBps: 30 }
const migrateAbi = [
	{
		type: 'function',
		name: 'migrate',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'fromId', type: 'uint256' },
			{ name: 'targetOutcomeIndexes', type: 'uint256[]' },
		],
		outputs: [],
	},
] as const
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

function decodeReceiveRequest(data: Hex) {
	// The router request is a static tuple, so its fields decode as flat ABI outputs.
	return decodeFunctionResult({
		abi: [{ type: 'function', name: 'receiveRequest', stateMutability: 'view', inputs: [], outputs: receiveRequestParameter.components }],
		functionName: 'receiveRequest',
		data,
	})
}

const market: LiveMarket = {
	pool,
	pair: undefined,
	shareToken,
	universeId: 7n,
	questionId: 8n,
	title: 'Forked market',
	description: 'Encoding fixture',
	endTime: 1n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 1n,
	systemState: 1,
	awaitingForkContinuation: false,
	universeForkTime: 1n,
	vaultCount: 0n,
	shareTokenSupplyAttoShares: 0n,
	settlementCollateralAttoEth: 0n,
	currentRetentionRate: 0n,
	totalCapacityOwnershipAttoRep: 0n,
	activeObligationUnits: 0n,
	mintingCapacityCeilingAttoEth: 0n,
	availableMintingCapacityAttoEth: 0n,
	feeBps: 30n,
	tradingStatus: 4,
	questionOutcome: 3,
	yesReserve: 0n,
	noReserve: 0n,
	lpTotalSupply: 0n,
}

function requireTransactionData(params: unknown) {
	if (!Array.isArray(params)) throw new Error('RPC parameters must be an array')
	const transaction: unknown = params[0]
	if (typeof transaction !== 'object' || transaction === null || !('data' in transaction)) throw new Error('RPC transaction must contain data')
	const data = transaction.data
	if (!isHexValue(data)) throw new Error('RPC transaction data must be hex')
	return data
}

function isHexValue(value: unknown): value is Hex {
	return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value)
}

describe('live settlement contract encoding', () => {
	for (const [side, outcome] of [
		['YES', 1],
		['NO', 2],
	] as const) {
		test(`keeps ${side} directional exit encoding distinct from redemption`, () => {
			const pair = `0x${'66'.repeat(20)}` as Address
			const transfer = receiveBasedExitArguments({ ...market, pair }, side, 10n, 23n, 9n, account, 421n)
			expect(transfer.ids).toEqual([1792n, 1792n | BigInt(outcome)])
			expect(transfer.amounts).toEqual([10n, 23n])
			const request = decodeReceiveRequest(transfer.data)
			expect(request).toEqual([1n, 0n, shareToken, pool, pair, 7n, 8n, 1792n, 1793n, 1794n, BigInt(outcome), 10n, 23n, 9n, account, account, 421n])
		})
	}

	test('encodes and submits ShareToken migration with the ShareToken ABI', async () => {
		const transactionData: Hex[] = []
		const client = createWalletClient({
			account,
			transport: custom({
				async request({ method, params }) {
					if (method === 'eth_blockNumber') return '0x2'
					if (method === 'eth_getBlockByNumber') {
						return { hash: blockHash, number: '0x2', parentHash: `0x${'66'.repeat(32)}`, timestamp: '0x1', transactions: [] }
					}
					if (method === 'eth_call') {
						transactionData.push(requireTransactionData(params))
						return '0x'
					}
					if (method === 'eth_sendTransaction') {
						transactionData.push(requireTransactionData(params))
						return transactionHash
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			}),
		})

		const selectedScalarTargets = [99n, 42n, 12n]
		const normalizedScalarTargets = [12n, 42n, 99n]
		await expect(simulateSettlement(client, configuration, market, account, 'migrate-shares', { sourceOutcome: 'YES', targetOutcomeIndexes: [12n, 12n] })).rejects.toThrow('only once')
		const quote = await simulateSettlement(client, configuration, market, account, 'migrate-shares', { sourceOutcome: 'YES', targetOutcomeIndexes: selectedScalarTargets })
		const uiQuote = { ...quote, account, walletClient: client, inputRevision: 0 }
		expect(quote.targetOutcomeIndexes).toEqual(normalizedScalarTargets)
		expect(settlementQuoteMatchesInputs(uiQuote, 0, market, 'migrate-shares', undefined, 'YES', selectedScalarTargets, account, client)).toBeTrue()
		expect(settlementQuoteMatchesInputs(uiQuote, 1, market, 'migrate-shares', undefined, 'YES', selectedScalarTargets, account, client)).toBeFalse()
		expect(settlementQuoteMatchesInputs(uiQuote, 0, market, 'migrate-shares', undefined, 'YES', [12n, 43n, 99n], account, client)).toBeFalse()
		expect(settlementQuoteCanSubmit('ready', undefined, true)).toBeTrue()
		expect(settlementQuoteCanSubmit('loading', undefined, true)).toBeFalse()
		expect(settlementQuoteCanSubmit('error', undefined, true)).toBeFalse()
		expect(await submitFreshSettlement(client, configuration, account, quote, async write => await write())).toBe(transactionHash)
		expect(transactionData).toHaveLength(3)
		for (const data of transactionData) {
			expect(decodeFunctionData({ abi: migrateAbi, data })).toEqual({ functionName: 'migrate', args: [(7n << 8n) | 1n, normalizedScalarTargets] })
		}
	})

	test('simulates and submits the exact final receive-based redemption payload', async () => {
		const pair = `0x${'66'.repeat(20)}` as Address
		const canonicalMarket = { ...market, pair, shareTokenSupplyAttoShares: 100n, settlementCollateralAttoEth: 100n }
		const transactionData: Hex[] = []
		const client = createWalletClient({
			account,
			transport: custom({
				async request({ method, params }) {
					if (method === 'eth_blockNumber') return '0x2'
					if (method === 'eth_getBlockByNumber') return { hash: blockHash, number: '0x2', parentHash: `0x${'66'.repeat(32)}`, timestamp: '0x1', transactions: [] }
					if (method === 'eth_call' || method === 'eth_sendTransaction') {
						transactionData.push(requireTransactionData(params))
						return method === 'eth_sendTransaction' ? transactionHash : '0x'
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			}),
		})
		const quote = await simulateSettlement(client, configuration, canonicalMarket, account, 'redeem-complete-set', { amount: 10n, validityMinutes: 7n, slippageBps: 500n })
		if (quote.operation !== 'redeem-complete-set') throw new Error('Expected complete-set quote')
		expect(quote.expectedAttoEth).toBe(10n)
		expect(quote.minimumAttoEth).toBe(9n)
		expect(await submitFreshSettlement(client, configuration, account, quote, async write => await write())).toBe(transactionHash)
		expect(transactionData).toHaveLength(3)
		expect(transactionData[1]).toBe(transactionData[0])
		expect(transactionData[2]).toBe(transactionData[0])
		const decodedTransfer = decodeFunctionData({ abi: shareTransferAbi, data: transactionData[0] })
		if (decodedTransfer.args === undefined) throw new Error('Missing share transfer arguments')
		expect(decodedTransfer.functionName).toBe('safeBatchTransferFrom')
		expect(decodedTransfer.args.slice(0, 4)).toEqual([account, configuration.router, [1792n, 1793n, 1794n], [10n, 10n, 10n]])
		// Decode independently from the production encoder and assert the router ABI contract.
		const request = decodeReceiveRequest(decodedTransfer.args[4])
		expect(request).toEqual([1n, 1n, shareToken, pool, pair, 7n, 8n, 1792n, 1793n, 1794n, 3n, 10n, 0n, 9n, account, account, 421n])
	})

	test('rejects complete-set submission when refreshed output falls below the approved minimum', async () => {
		let sends = 0
		const client = createWalletClient({
			account,
			transport: custom({
				async request({ method }) {
					if (method === 'eth_blockNumber') return '0x2'
					if (method === 'eth_getBlockByNumber') return { hash: blockHash, number: '0x2', parentHash: `0x${'66'.repeat(32)}`, timestamp: '0x1', transactions: [] }
					if (method === 'eth_call') return '0x'
					if (method === 'eth_sendTransaction') {
						sends++
						return transactionHash
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			}),
		})
		const canonicalMarket = { ...market, pair: `0x${'66'.repeat(20)}` as Address, shareTokenSupplyAttoShares: 100n, settlementCollateralAttoEth: 100n }
		const quote = await simulateSettlement(client, configuration, canonicalMarket, account, 'redeem-complete-set', { amount: 10n ** 18n })
		if (quote.operation !== 'redeem-complete-set') throw new Error('Expected complete-set quote')
		await expect(submitFreshSettlement(client, configuration, account, { ...quote, minimumAttoEth: quote.expectedAttoEth + 1n }, async write => await write())).rejects.toThrow('approved minimum ETH output')
		expect(sends).toBe(0)
	})

	test('runs the wallet-context guard after revalidation and before broadcasting', async () => {
		let simulations = 0
		let sends = 0
		let guards = 0
		const client = createWalletClient({
			account,
			transport: custom({
				async request({ method }) {
					if (method === 'eth_blockNumber') return '0x2'
					if (method === 'eth_getBlockByNumber') return { hash: blockHash, number: '0x2', parentHash: `0x${'66'.repeat(32)}`, timestamp: '0x1', transactions: [] }
					if (method === 'eth_call') {
						simulations++
						return '0x'
					}
					if (method === 'eth_sendTransaction') {
						sends++
						return transactionHash
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			}),
		})
		const quote = await simulateSettlement(client, configuration, market, account, 'migrate-shares', { sourceOutcome: 'YES', targetOutcomeIndexes: [12n] })
		await expect(
			submitFreshSettlement(client, configuration, account, quote, async () => {
				guards++
				throw new Error('Wallet context changed during revalidation')
			}),
		).rejects.toThrow('Wallet context changed during revalidation')
		expect(simulations).toBe(2)
		expect(guards).toBe(1)
		expect(sends).toBe(0)
	})
})
