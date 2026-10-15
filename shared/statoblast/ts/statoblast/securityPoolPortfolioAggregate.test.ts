import { expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDepositRequest, buildPortfolioFundWithdrawalRequest, buildPortfolioPositionClaimRequest, loadPortfolioAggregateSnapshot, loadPortfolioMintQuote } from './securityPoolPortfolioAggregate.js'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const portfolio: Address = '0x0000000000000000000000000000000000000002'
const token: Address = '0x0000000000000000000000000000000000000003'
const feed: Address = '0x0000000000000000000000000000000000000004'
const coordinator: Address = '0x0000000000000000000000000000000000000005'
const seedPool: Address = '0x0000000000000000000000000000000000000006'
const zoltar: Address = '0x0000000000000000000000000000000000000007'
const abi = parseAbi(['function deposit(uint256,uint256)', 'function withdraw(uint256,uint256)', 'function claimPosition(uint256,address)'])

test('deposit and exit preserve owner identity and explicit slippage bounds', () => {
	const deposit = buildPortfolioDepositRequest({ owner, portfolio, amountAttoRep: 40n, minimumShares: 19n })
	expect(deposit).toMatchObject({ account: owner, to: portfolio, value: 0n })
	expect(decodeFunctionData({ abi, data: deposit.data })).toEqual({ functionName: 'deposit', args: [40n, 19n] })
	const withdrawal = buildPortfolioFundWithdrawalRequest({ owner, portfolio, shares: 10n, minimumIdleAttoRep: 8n })
	expect(decodeFunctionData({ abi, data: withdrawal.data })).toEqual({ functionName: 'withdraw', args: [10n, 8n] })
	expect(() => buildPortfolioDepositRequest({ owner, portfolio, amountAttoRep: 0n, minimumShares: 0n })).toThrow('positive')
	expect(() => buildPortfolioFundWithdrawalRequest({ owner, portfolio, shares: 1n, minimumIdleAttoRep: -1n })).toThrow('uint256')
})

test('permissionless question recovery binds the actual beneficiary instead of the processor', () => {
	const claim = buildPortfolioPositionClaimRequest({ processor: token, portfolio, positionId: 9n, owner })
	expect(claim.account).toBe(token)
	expect(decodeFunctionData({ abi, data: claim.data })).toEqual({ functionName: 'claimPosition', args: [9n, owner] })
})

function reads() {
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
					return 100n
				case 'claimableFees':
					return 3n
				case 'getAggregateState':
					return [100n, 30n, 40n, 10n, 12n]
				case 'getActiveQuestions':
					return [9n]
				case 'frozenPositionCount':
					return 2n
				case 'getFrozenPositionIds':
					return [8n, 9n]
				case 'frozenPositions':
					return [request.args?.[0], 20n, 10n, token]
				case 'getOwnerPositionShares':
					return request.args?.[0] === 8n ? 2n : 0n
				case 'quoteMint':
					return [7n, 2n, 40n]
				default:
					throw new Error(`Unexpected read ${request.functionName}`)
			}
		},
	}
	return { client, calls }
}

test('aggregate holdings distinguish current NAV, matured claims, wallet REP and pool approval at one block', async () => {
	const { client, calls } = reads()
	const snapshot = await loadPortfolioAggregateSnapshot({ client, portfolio, owner })
	expect(snapshot).toMatchObject({ shares: 5n, totalShares: 20n, ownerAssetsAttoRep: 25n, walletAttoRep: 60n, allowanceAttoRep: 40n, claimableFeesAttoEth: 3n, availableAttoRep: 40n })
	expect(snapshot.positions).toEqual([
		{ positionId: 8n, questionId: 8n, custody: token, ownerShares: 2n },
		{ positionId: 9n, questionId: 9n, custody: token, ownerShares: 0n },
	])
	expect(calls.every(call => call.blockNumber === 50n)).toBe(true)
	expect(calls.find(call => call.functionName === 'allowance')?.args).toEqual([owner, portfolio])
	expect(calls.some(call => call.functionName === 'vaultOf' || call.functionName === 'securityVaults')).toBe(false)
	expect(await loadPortfolioMintQuote({ client, snapshot, questionId: 9n, mintAttoEth: 10n })).toEqual({ depositAttoRep: 7n, reservationFeeAttoEth: 2n, availableAttoRep: 40n })
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
