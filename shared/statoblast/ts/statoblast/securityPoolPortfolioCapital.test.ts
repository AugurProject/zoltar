import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioCapitalAuthorizeRequest,
	buildPortfolioCapitalDepositRequest,
	buildPortfolioCapitalFundExecutionReserveRequest,
	buildPortfolioCapitalRequestRetirementRequest,
	buildPortfolioCapitalSetHealthRequest,
	buildPortfolioCapitalTakeOverRequest,
	buildPortfolioCapitalWithdrawFreeRequest,
	loadPortfolioCapitalSnapshot,
	requiredPortfolioExecutionReserve,
	type PortfolioReadClient,
} from './securityPoolPortfolio.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const portfolio: Address = '0x0000000000000000000000000000000000000002'
const capitalLedger: Address = '0x0000000000000000000000000000000000000003'
const index: Address = '0x0000000000000000000000000000000000000004'
const repToken: Address = '0x0000000000000000000000000000000000000005'
const hash: Hex = `0x${'11'.repeat(32)}`
const base = { owner, capitalLedger }
const abi = parseAbi([
	'function depositFor(address owner,uint256 amount)',
	'function withdrawFree(uint256 amount,address recipient)',
	'function authorize(uint256 rep,uint256 commitment)',
	'function fundExecutionReserve(address owner) payable',
	'function requestRetirement(uint96 id)',
	'function takeOver(uint96 id,uint256 commitment,uint256 minimumAward,uint256 maximumOwnRep)',
])

function fixture(overrides: Record<string, unknown> = {}) {
	const calls: { functionName: string; blockNumber: bigint }[] = []
	const values: Record<string, unknown> = {
		originUniverseId: 7n,
		capitalLedger,
		commitmentIndex: index,
		repToken,
		zoltar: portfolio,
		settlement: portfolio,
		ledger: portfolio,
		minimumOutcomeExchangeRate: 1_000n,
		purchaseFeeBps: 100n,
		annualFeeBps: 1_000n,
		minimumPurchaseFeeAttoEth: 1n,
		minimumCommitmentAttoEth: 1n,
		minimumExecutionReserveAttoEth: 1n,
		rewardVestingSeconds: 86_400n,
		acceptedPrice: 2n,
		securityMultiplierBps: 10_500n,
		priceValidUntil: 5_000n,
		isPriceValid: true,
		demandAttoEth: 40n,
		totalFreeAttoRep: 100n,
		frozen: false,
		importing: false,
		exported: false,
		totals: [600n, 60n, 50n],
		currentBatch: 9n,
		nextBatch: 10n,
		getForkTime: 0n,
		ownerAccount: { freeAttoRep: 10n, feesAttoEth: 3n, feesAttoRep: 4n, executionReserveAttoEth: 5n, targetHealthFactorBps: 12_000n, positions: [1n, 2n, 0n] },
		positionExecutionReserveAttoEth: 7n,
		liquidationStarted: 0n,
		...overrides,
	}
	const client: PortfolioReadClient = {
		getChainId: async () => 1,
		getBlock: async () => ({ number: 42n, hash, timestamp: 1_000n }),
		readContract: async parameters => {
			calls.push({ functionName: parameters.functionName, blockNumber: parameters.blockNumber })
			if (parameters.functionName === 'accountOf') return { owner, batch: parameters.args?.[0] === 1n ? 0n : 8n, rep: parameters.args?.[0] === 1n ? 200n : 0n, commitment: parameters.args?.[0] === 1n ? 20n : 0n, maxHealthyPrice: 20n, releasedRep: parameters.args?.[0] === 1n ? 0n : 50n, ethFees: 11n, repFees: 13n }
			if (!(parameters.functionName in values)) throw new Error(`Unexpected read ${parameters.functionName}`)
			return values[parameters.functionName]
		},
	}
	return { client, calls }
}

describe('personal portfolio capital SDK', () => {
	test('execution funding rounds capacity units up and preserves zero-capacity and integer boundaries', () => {
		const economics = { minimumCommitmentAttoEth: 10n, minimumExecutionReserveAttoEth: 3n }
		expect(requiredPortfolioExecutionReserve({ ...economics, commitment: 0n })).toBe(0n)
		expect(requiredPortfolioExecutionReserve({ ...economics, commitment: 10n })).toBe(3n)
		expect(requiredPortfolioExecutionReserve({ ...economics, commitment: 11n })).toBe(6n)
		expect(requiredPortfolioExecutionReserve({ ...economics, commitment: 20n })).toBe(6n)
		expect(() => requiredPortfolioExecutionReserve({ ...economics, commitment: 20n, minimumCommitmentAttoEth: 0n })).toThrow('positive')
	})
	test('deposits and withdrawals operate exact REP and preserve recipient and owner identities', () => {
		const deposit = buildPortfolioCapitalDepositRequest({ ...base, amountAttoRep: 123n })
		expect(deposit).toMatchObject({ account: owner, to: capitalLedger, value: 0n })
		expect(decodeFunctionData({ abi, data: deposit.data })).toEqual({ functionName: 'depositFor', args: [owner, 123n] })
		const withdrawal = buildPortfolioCapitalWithdrawFreeRequest({ ...base, amountAttoRep: 77n, recipient: portfolio })
		expect(decodeFunctionData({ abi, data: withdrawal.data })).toEqual({ functionName: 'withdrawFree', args: [77n, portfolio] })
	})

	test('underwriting, retirement and takeovers carry explicit bounded authorization', () => {
		expect(decodeFunctionData({ abi, data: buildPortfolioCapitalAuthorizeRequest({ ...base, rep: 126n, commitment: 100n }).data })).toEqual({ functionName: 'authorize', args: [126n, 100n] })
		expect(decodeFunctionData({ abi, data: buildPortfolioCapitalRequestRetirementRequest({ ...base, positionId: 9n }).data })).toEqual({ functionName: 'requestRetirement', args: [9n] })
		expect(decodeFunctionData({ abi, data: buildPortfolioCapitalTakeOverRequest({ ...base, positionId: 9n, commitment: 17n, minimumAward: 11n, maximumOwnRep: 30n }).data })).toEqual({ functionName: 'takeOver', args: [9n, 17n, 11n, 30n] })
		expect(buildPortfolioCapitalFundExecutionReserveRequest({ ...base, amountAttoEth: 100n }).value).toBe(100n)
		expect(() => buildPortfolioCapitalSetHealthRequest({ ...base, targetHealthFactorBps: 9_999n })).toThrow('100%')
		expect(() => buildPortfolioCapitalRequestRetirementRequest({ ...base, positionId: 2n ** 96n })).toThrow('uint96')
		expect(() => buildPortfolioCapitalDepositRequest({ ...base, amountAttoRep: 0n })).toThrow('positive')
	})

	test('pins reads to one block and settles at most three direct positions without question history', async () => {
		const { client, calls } = fixture()
		const snapshot = await loadPortfolioCapitalSnapshot({ client, portfolio, owner })
		expect(snapshot).toMatchObject({ capitalLedger, commitmentIndex: index, repToken, universeId: 7n, totalPledgedAttoRep: 600n, totalCommitmentAttoEth: 60n, healthyCommitmentAttoEth: 50n, currentBatch: 9n, nextBatch: 10n, withdrawableAttoRep: 60n, accruedFeesAttoEth: 25n, accruedFeesAttoRep: 30n })
		expect(snapshot.positions.map(position => position.id)).toEqual([1n, 2n])
		expect(snapshot.positions[1]).toMatchObject({ releasedRep: 50n, commitment: 0n, executionReserveAttoEth: 7n })
		expect(new Set(calls.map(call => call.blockNumber))).toEqual(new Set([42n]))
		expect(calls.filter(call => call.functionName === 'accountOf')).toHaveLength(2)
		expect(calls.length).toBeLessThan(50)
	})

	test('a composing fork reader can select the same confirmed block for every capital read', async () => {
		const { client, calls } = fixture()
		const requested: (bigint | undefined)[] = []
		client.getBlock = async parameters => {
			requested.push(parameters?.blockNumber)
			return { number: 39n, hash, timestamp: 900n }
		}
		const snapshot = await loadPortfolioCapitalSnapshot({ client, portfolio, owner, blockNumber: 39n })
		expect(snapshot.blockNumber).toBe(39n)
		expect(requested).toEqual([39n, 39n])
		expect(new Set(calls.map(call => call.blockNumber))).toEqual(new Set([39n]))
	})

	test('rejects malformed ownership and reorgs instead of double-counting or mixing snapshots', async () => {
		const malformed = fixture({ ownerAccount: [10n, 3n, 4n, 5n, 12_000n, [1n, 1n, 0n]] })
		await expect(loadPortfolioCapitalSnapshot({ client: malformed.client, portfolio, owner })).rejects.toThrow('duplicate position')
		const reorg = fixture()
		let reads = 0
		reorg.client.getBlock = async () => ({ number: 42n, hash: reads++ === 0 ? hash : '0x22', timestamp: 1_000n })
		await expect(loadPortfolioCapitalSnapshot({ client: reorg.client, portfolio, owner })).rejects.toThrow('Chain changed')
	})
})
