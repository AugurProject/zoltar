import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, decodeFunctionData, type Address, type Hex } from '@zoltar/shared/ethereum'
import { settlementQuoteCanSubmit, settlementQuoteMatchesInputs } from '../features/LiveTrading.tsx'
import { simulateSettlement, submitFreshSettlement, type LiveMarket } from '../protocol/live.ts'

const account = `0x${'11'.repeat(20)}` as Address
const shareToken = `0x${'22'.repeat(20)}` as Address
const pool = `0x${'33'.repeat(20)}` as Address
const transactionHash = `0x${'44'.repeat(32)}` as Hex
const blockHash = `0x${'55'.repeat(32)}` as Hex
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
	activeVaultCount: 0n,
	shareTokenSupplyAttoShares: 0n,
	settlementCollateralAttoEth: 0n,
	currentRetentionRate: 0n,
	totalCoverageCommitmentAttoEth: 0n,
	feeEligibleCoverageCommitmentAttoEth: 0n,
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

		const quote = await simulateSettlement(client, market, account, 'migrate-shares', { sourceOutcome: 'YES', targetOutcomeIndex: 12n })
		const uiQuote = { ...quote, account, walletClient: client, inputRevision: 0 }
		expect(settlementQuoteMatchesInputs(uiQuote, 0, market, 'migrate-shares', undefined, 'YES', 12n, account, client)).toBeTrue()
		expect(settlementQuoteMatchesInputs(uiQuote, 1, market, 'migrate-shares', undefined, 'YES', 12n, account, client)).toBeFalse()
		expect(settlementQuoteMatchesInputs(uiQuote, 0, market, 'migrate-shares', undefined, 'YES', 13n, account, client)).toBeFalse()
		expect(settlementQuoteCanSubmit('ready', undefined, true)).toBeTrue()
		expect(settlementQuoteCanSubmit('loading', undefined, true)).toBeFalse()
		expect(settlementQuoteCanSubmit('error', undefined, true)).toBeFalse()
		expect(await submitFreshSettlement(client, account, quote)).toBe(transactionHash)
		expect(transactionData).toHaveLength(3)
		for (const data of transactionData) {
			expect(decodeFunctionData({ abi: migrateAbi, data })).toEqual({ functionName: 'migrate', args: [(7n << 8n) | 1n, [12n]] })
		}
	})
})
