import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, decodeFunctionData, encodeAbiParameters, type Address, type Hex } from '@zoltar/shared/ethereum'
import type { DeploymentConfiguration } from '../protocol/config.ts'
import { simulateEntry, simulateExit, simulateLiquidity, submitFreshEntry, submitFreshExit, submitFreshLiquidity, type LiveMarket } from '../protocol/live.ts'
import { tradingContracts } from '../generated/contractArtifact.ts'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const pair = `0x${'33'.repeat(20)}` as Address
const shareToken = `0x${'44'.repeat(20)}` as Address
const blockHash = `0x${'55'.repeat(32)}` as Hex
const transactionHash = `0x${'66'.repeat(32)}` as Hex
const routerAbi = tradingContracts['trading/contracts/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter.abi
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

describe('live guarded transaction writes', () => {
	test('checks the wallet context after entry, exit, and liquidity revalidation and before every broadcast', async () => {
		let sends = 0
		const client = createWalletClient({
			account,
			transport: custom({
				async request({ method, params }) {
					if (method === 'eth_blockNumber') return '0x2'
					if (method === 'eth_getBlockByNumber') return { hash: blockHash, number: '0x2', parentHash: `0x${'aa'.repeat(32)}`, timestamp: '0x1', transactions: [] }
					if (method === 'eth_call') {
						const decoded = decodeFunctionData({ abi: routerAbi, data: callData(params) })
						if (decoded.functionName === 'enterPosition') return encodeAbiParameters([{ type: 'tuple', components: [uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256] }], [[10n, 10n, 1n, 2n, 12n, 10n, 1n, 5_000n, 5_001n]])
						if (decoded.functionName === 'exitPosition') return encodeAbiParameters([{ type: 'tuple', components: [uint256, uint256, uint256, uint256, uint256, uint256] }], [[10n, 2n, 12n, 10n, 1_000n, 1n]])
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
		const deadline = 2n ** 200n
		const entry = await simulateEntry(client, configuration, market, account, 'YES', 10n, deadline)
		const exit = await simulateExit(client, configuration, market, account, 'YES', 10n, deadline)
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
