import { expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioClaimRecoveredRequest, buildPortfolioDepositRequest, buildPortfolioFundWithdrawalRequest, buildPortfolioPositionClaimRequest, buildPortfolioPositionRebalanceRequest, loadPortfolioAggregateSnapshot, loadPortfolioMintQuote } from './securityPoolPortfolioAggregate.js'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const portfolio: Address = '0x0000000000000000000000000000000000000002'
const token: Address = '0x0000000000000000000000000000000000000003'
const feed: Address = '0x0000000000000000000000000000000000000004'
const coordinator: Address = '0x0000000000000000000000000000000000000005'
const seedPool: Address = '0x0000000000000000000000000000000000000006'
const zoltar: Address = '0x0000000000000000000000000000000000000007'
const abi = parseAbi(['function deposit(uint256,uint256)', 'function withdraw(uint256,uint256)', 'function claimPosition(uint256,uint256)', 'function rebalancePosition(uint256)', 'function claimRecovered(uint256[],uint256[])'])

test('deposit and exit preserve owner identity and explicit slippage bounds', () => {
	const deposit = buildPortfolioDepositRequest({ owner, portfolio, amountAttoRep: 40n, minimumShares: 19n })
	expect(deposit).toMatchObject({ account: owner, to: portfolio, value: 0n })
	expect(decodeFunctionData({ abi, data: deposit.data })).toEqual({ functionName: 'deposit', args: [40n, 19n] })
	const withdrawal = buildPortfolioFundWithdrawalRequest({ owner, portfolio, shares: 10n, minimumIdleAttoRep: 8n })
	expect(decodeFunctionData({ abi, data: withdrawal.data })).toEqual({ functionName: 'withdraw', args: [10n, 8n] })
	expect(() => buildPortfolioDepositRequest({ owner, portfolio, amountAttoRep: 0n, minimumShares: 0n })).toThrow('positive')
	expect(() => buildPortfolioFundWithdrawalRequest({ owner, portfolio, shares: 1n, minimumIdleAttoRep: -1n })).toThrow('uint256')
})

test('individual position recovery binds the signing owner and personal interval', () => {
	const claim = buildPortfolioPositionClaimRequest({ owner, portfolio, positionId: 9n, intervalId: 2n })
	expect(claim.account).toBe(owner)
	expect(decodeFunctionData({ abi, data: claim.data })).toEqual({ functionName: 'claimPosition', args: [9n, 2n] })
})

test('permissionless maintenance selects one allocation without an owner route', () => {
	const request = buildPortfolioPositionRebalanceRequest({ processor: token, portfolio, positionId: 19n })
	expect(request).toMatchObject({ account: token, to: portfolio, value: 0n })
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'rebalancePosition', args: [19n] })
	expect(() => buildPortfolioPositionRebalanceRequest({ processor: token, portfolio, positionId: -1n })).toThrow('uint256')
})

function reads(options: { positionCount?: bigint; questionCount?: bigint; assets?: bigint; price?: bigint; multiplier?: bigint; intervalCount?: bigint } = {}) {
	const calls: Parameters<PortfolioReadClient['readContract']>[0][] = []
	const client: PortfolioReadClient = {
		getChainId: async () => 1,
		getBlock: async () => ({ number: 50n, hash: zeroHash, timestamp: 100n }),
		readContract: async request => {
			calls.push(request)
			switch (request.functionName) {
				case 'priceFeed':
					expect(request.address).toBe(portfolio)
					expect(request.args).toEqual([0n])
					return feed
				case 'configCoordinator':
					expect(request.address).toBe(feed)
					return coordinator
				case 'securityPool':
					expect(request.address).toBe(coordinator)
					return seedPool
				case 'zoltar':
					expect(request.address).toBe(seedPool)
					return zoltar
				case 'getForkTime':
					expect(request.address).toBe(zoltar)
					return 0n
				case 'recoveryLedger':
					return zoltar
				case 'processingRewards':
					return 5n
				case 'getOwnerIntervalCount':
					return options.intervalCount ?? 1n
				case 'getOwnerInterval':
					return { generation: 1n, startPosition: 1n, endPosition: 0n, shares: 5n, repIndex: 0n, feeIndex: 0n, open: true, active: true }
				case 'previewClaim':
					return [17n, 19n]
				case 'positionRecoveryComplete':
					return false
				case 'recoveryBounties':
					return 7n
				case 'originUniverseId':
					return 0n
				case 'repToken':
					return token
				case 'balanceOf':
					return request.address === portfolio ? 5n : 60n
				case 'allowance':
					return 40n
				case 'totalSupply':
					return 20n
				case 'totalAssets':
					return options.assets ?? 100n
				case 'claimableFees':
					return 3n
				case 'statoblastSecurityMultiplierBps':
					return options.multiplier ?? 10_500n
				case 'lastPrice':
					expect(request.address).toBe(feed)
					return options.price ?? 6n * 10n ** 18n
				case 'positionCount':
					return options.positionCount ?? 2n
				case 'questionCount':
					return options.questionCount ?? 1n
				case 'getQuestions': {
					const [start, count] = request.args ?? []
					if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected bounded page')
					return Array.from({ length: Number(count) }, (_, index) => start + BigInt(index) + 9n)
				}
				case 'positions':
					return [request.args?.[0], 20n, 10n, token]
				case 'isReusablePosition':
					return request.args?.[0] === 2n
				case 'getPool':
					return seedPool
				case 'questionData':
					return zoltar
				case 'systemState':
					return 0
				case 'isEscalationResolved':
					return false
				case 'getQuestionEndDate':
					return 1000n
				case 'getOwnerPositionShares':
					return request.args?.[0] === 1n ? 2n : 0n
				case 'quoteMint':
					return [7n, 2n, 40n]
				default:
					throw new Error(`Unexpected read ${request.functionName}`)
			}
		},
	}
	return { client, calls }
}

test('reserve ownership stays separate from allocation claims at one pinned block', async () => {
	const { client, calls } = reads()
	const snapshot = await loadPortfolioAggregateSnapshot({ client, portfolio, owner })
	expect(snapshot).toMatchObject({ shares: 5n, totalShares: 20n, ownerAssetsAttoRep: 25n, walletAttoRep: 60n, allowanceAttoRep: 40n, claimableFeesAttoEth: 3n, reserveAttoRep: 100n, reserveCapacityAttoEth: 12n, questions: [9n] })
	expect(snapshot.positions).toEqual([
		{ positionId: 1n, questionId: 1n, custody: token, ownerShares: 2n, remainingShares: 10n, reusable: false, recoveryComplete: false, recoveryBountyAttoEth: 7n, questionEndTime: 1000n, operational: true, resolved: false },
		{ positionId: 2n, questionId: 2n, custody: token, ownerShares: 0n, remainingShares: 10n, reusable: true, recoveryComplete: false, recoveryBountyAttoEth: 7n, questionEndTime: 1000n, operational: true, resolved: false },
	])
	expect(calls.every(call => call.blockNumber === 50n)).toBe(true)
	expect(calls.find(call => call.functionName === 'allowance')?.args).toEqual([owner, portfolio])
	expect(calls.some(call => call.functionName === 'vaultOf' || call.functionName === 'securityVaults')).toBe(false)
	expect(await loadPortfolioMintQuote({ client, snapshot, questionId: 9n, mintAttoEth: 10n })).toEqual({ depositAttoRep: 7n, purchaseFeeAttoEth: 2n, availableAttoRep: 40n })
})

test('allocation and registered-question pages stay bounded beyond sixteen positions', async () => {
	const { client, calls } = reads({ positionCount: 130n, questionCount: 130n })
	const first = await loadPortfolioAggregateSnapshot({ client, portfolio, owner })
	expect(first.positions).toHaveLength(64)
	expect(first.questions).toHaveLength(64)
	const last = await loadPortfolioAggregateSnapshot({ client, portfolio, owner, positionStart: 128n, questionStart: 128n })
	expect(last.positions.map(position => position.positionId)).toEqual([129n, 130n])
	expect(last.questions).toEqual([137n, 138n])
	expect(calls.filter(call => call.functionName === 'getQuestions').map(call => call.args)).toEqual([
		[0n, 64n],
		[128n, 2n],
	])
	await expect(loadPortfolioAggregateSnapshot({ client, portfolio, owner, positionStart: 131n })).rejects.toThrow('Position page is out of bounds')
	await expect(loadPortfolioAggregateSnapshot({ client, portfolio, owner, questionStart: 131n })).rejects.toThrow('Question page is out of bounds')
})

test('reserve capacity uses the pinned feed price, native multiplier floor and sequential rounding', async () => {
	for (const [options, capacity] of [
		[{ price: 0n }, 0n],
		[{ assets: 5n, price: 3n * 10n ** 18n, multiplier: 1n }, 0n],
		[{ assets: 101n, price: 3n * 10n ** 18n, multiplier: 20_000n }, 13n],
	] as const) {
		const { client, calls } = reads({ ...options, positionCount: 0n, questionCount: 0n })
		const snapshot = await loadPortfolioAggregateSnapshot({ client, portfolio, owner })
		expect(snapshot.reserveCapacityAttoEth).toBe(capacity)
		expect(snapshot.reserveAttoRep).toBe(snapshot.assetsAttoRep)
		expect(calls.every(call => call.blockNumber === snapshot.blockNumber)).toBe(true)
	}
})

test('a changed chain anchor cannot authorize a deposit or mint quote', async () => {
	const { client } = reads()
	const snapshot = await loadPortfolioAggregateSnapshot({ client, portfolio, owner })
	client.getChainId = async () => 2
	await expect(loadPortfolioMintQuote({ client, snapshot, questionId: 9n, mintAttoEth: 10n })).rejects.toThrow('Chain changed')
	let calls = 0
	client.getChainId = async () => ++calls
	await expect(loadPortfolioAggregateSnapshot({ client, portfolio, owner })).rejects.toThrow('Chain changed')
})

test('combined collection normalizes personal intervals and permits already credited rewards alone', () => {
	const collect = buildPortfolioClaimRecoveredRequest({ owner, portfolio, intervalIds: [9n, 2n, 9n, 0n] })
	expect(collect.account).toBe(owner)
	expect(decodeFunctionData({ abi, data: collect.data })).toEqual({ functionName: 'claimRecovered', args: [[0n, 2n, 9n], []] })
	expect(decodeFunctionData({ abi, data: buildPortfolioClaimRecoveredRequest({ owner, portfolio, intervalIds: [] }).data }).args).toEqual([[], []])
	expect(() => buildPortfolioClaimRecoveredRequest({ owner, portfolio, intervalIds: [-1n] })).toThrow('uint256')
	const withRecovery = buildPortfolioClaimRecoveredRequest({ owner, portfolio, intervalIds: [0n], positionIds: [12n, 3n, 12n] })
	expect(decodeFunctionData({ abi, data: withRecovery.data }).args).toEqual([[0n], [3n, 12n]])
	expect(() => buildPortfolioClaimRecoveredRequest({ owner, portfolio, intervalIds: [], positionIds: [-1n] })).toThrow('uint256')
})

test('combined recovery reads only personal history pages and includes exact carry, fees and processing rewards', async () => {
	const { client, calls } = reads({ positionCount: 100_000n, intervalCount: 130n })
	const snapshot = await loadPortfolioAggregateSnapshot({ client, portfolio, owner, intervalStart: 128n })
	expect(snapshot.intervals.map(interval => interval.intervalId)).toEqual([128n, 129n])
	expect(snapshot).toMatchObject({ intervalCount: 130n, intervalStart: 128n, recoverableRepAttoRep: 17n, recoverableFeesAttoEth: 27n, processingRewardsAttoEth: 5n })
	expect(calls.filter(call => call.functionName === 'getOwnerInterval')).toHaveLength(2)
	expect(calls.find(call => call.functionName === 'previewClaim')?.args).toEqual([owner, [128n, 129n]])
	expect(calls.every(call => call.blockNumber === 50n)).toBe(true)
	await expect(loadPortfolioAggregateSnapshot({ client, portfolio, owner, intervalStart: 131n })).rejects.toThrow('Recovery history page is out of bounds')
})
