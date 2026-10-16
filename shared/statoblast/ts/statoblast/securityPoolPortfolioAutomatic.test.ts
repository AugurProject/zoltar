import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, zeroAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioMintRequest,
	buildPortfolioWithdrawalRequest,
	buildPortfolioWithdrawEthRequest,
	buildPortfolioCancelWithdrawalRequest,
	buildPortfolioWithdrawalResidualForfeitureRequest,
	buildPortfolioProcessWithdrawalRequest,
	loadPortfolioRecoveryState,
	loadPortfolioWithdrawalRequests,
} from './securityPoolPortfolioAutomatic.js'
import { exportPortfolioTransaction } from './securityPoolPortfolio.js'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const vault: Address = '0x0000000000000000000000000000000000000002'
const portfolio: Address = '0x0000000000000000000000000000000000000003'
const processor: Address = '0x0000000000000000000000000000000000000004'
const abi = parseAbi(['function createCompleteSet(uint256,address,uint256,uint256) payable', 'function requestWithdrawal()', 'function withdrawEth()', 'function cancelWithdrawal()', 'function setWithdrawalResidualForfeiture(bool)', 'function processWithdrawal(uint256,uint248)'])

describe('native recovery authority and aggregate mint requests', () => {
	test('binds aggregate mint collateral, maximum fee, recipient and minimum shares', () => {
		const parameters = { trader: processor, portfolio, questionId: 51n, recipient: owner, minimumShares: 6n, mintAttoEth: 10n, maximumPurchaseFeeAttoEth: 3n }
		const request = buildPortfolioMintRequest(parameters)
		expect(request).toMatchObject({ account: processor, to: portfolio, value: 13n })
		const exported = exportPortfolioTransaction({ chainId: 1, request })
		expect(exported.value).toBe('13')
		expect(decodeFunctionData({ abi, data: exported.data }).args?.[3]).toBe(10n)
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'createCompleteSet', args: [51n, owner, 6n, 10n] })
		expect(() => buildPortfolioMintRequest({ ...parameters, mintAttoEth: 0n })).toThrow('positive')
		expect(() => buildPortfolioMintRequest({ ...parameters, recipient: zeroAddress })).toThrow('nonzero')
		expect(() => buildPortfolioMintRequest({ ...parameters, maximumPurchaseFeeAttoEth: -1n })).toThrow('Maximum purchase fee')
		expect(() => buildPortfolioMintRequest({ ...parameters, maximumPurchaseFeeAttoEth: (1n << 256n) - 1n })).toThrow('ETH value')
	})

	test('separates owner request/cancel from permissionless processing and offers no payout recipient override', () => {
		expect(decodeFunctionData({ abi, data: buildPortfolioWithdrawalRequest({ owner, vault }).data }).functionName).toBe('requestWithdrawal')
		expect(decodeFunctionData({ abi, data: buildPortfolioCancelWithdrawalRequest({ owner, vault }).data }).functionName).toBe('cancelWithdrawal')
		for (const allowed of [false, true]) expect(decodeFunctionData({ abi, data: buildPortfolioWithdrawalResidualForfeitureRequest({ owner, vault, allowed }).data })).toEqual({ functionName: 'setWithdrawalResidualForfeiture', args: [allowed] })
		const request = buildPortfolioProcessWithdrawalRequest({ processor, vault, questionId: 51n, universeId: 9n })
		expect(request.account).toBe(processor)
		expect(request.to).toBe(vault)
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'processWithdrawal', args: [51n, 9n] })
		expect(() => buildPortfolioProcessWithdrawalRequest({ processor, vault, questionId: 51n, universeId: 1n << 248n })).toThrow('uint248')
	})
})

function reads(count = 65n) {
	const calls: { functionName: string; blockNumber: bigint; args: readonly unknown[] }[] = []
	const client: PortfolioReadClient = {
		getChainId: async () => 1,
		getBlock: async () => ({ number: 33n, hash: zeroHash, timestamp: 100n }),
		readContract: async ({ functionName, blockNumber, args = [] }) => {
			calls.push({ functionName, blockNumber, args })
			switch (functionName) {
				case 'getEthBalance':
					return 12n

				case 'allocationPolicyVersion':
					return 3n
				case 'allocationPolicyNonce':
					return 7n
				case 'withdrawalRequested':
					return true
				case 'withdrawalResidualForfeitureAllowed':
					return false
				case 'withdrawalRequestId':
					return 2n
				case 'maximumQuestionHorizonSeconds':
					return 30n * 86400n
				case 'allocatedQuestionCount':
					return count
				case 'getAllocatedQuestions': {
					const [start, size] = args
					if (typeof start !== 'bigint' || typeof size !== 'bigint') throw new Error('Invalid page')
					return Array.from({ length: Number(size) }, (_, index) => start + BigInt(index) + 1n)
				}
				case 'withdrawalRequestCount':
					return 2n
				case 'getWithdrawalRequests':
					return [
						{ vault, requestId: 1n },
						{ vault: owner, requestId: 9n },
					]
				default:
					throw new Error(`Unexpected read ${functionName}`)
			}
		},
	}
	return { client, calls }
}

test('native recovery discovery pages only this owner’s allocations and anchors every read', async () => {
	const { client, calls } = reads()
	const state = await loadPortfolioRecoveryState({ client, vault, blockNumber: 33n })
	expect(state).toMatchObject({ ethBalanceAttoEth: 12n, withdrawalRequested: true, withdrawalResidualForfeitureAllowed: false, withdrawalRequestId: 2n, allocatedQuestionsComplete: true })
	expect(state.allocatedQuestions).toHaveLength(65)
	expect(calls.filter(call => call.functionName === 'getAllocatedQuestions').map(call => call.args)).toEqual([
		[0n, 64n],
		[64n, 1n],
	])
	expect(calls.every(call => call.blockNumber === 33n)).toBe(true)
	expect(calls.some(call => call.functionName === 'getQuestions')).toBe(false)
})

test('reports bounded allocation discovery and keeps independent request identities', async () => {
	const { client } = reads()
	const state = await loadPortfolioRecoveryState({ client, vault, blockNumber: 33n, maximumQuestions: 1 })
	expect(state.allocatedQuestionsComplete).toBe(false)
	expect(state.allocatedQuestions).toEqual([1n])
	expect(await loadPortfolioWithdrawalRequests({ client, portfolio, blockNumber: 33n, start: 0n, count: 16n })).toEqual({
		total: 2n,
		requests: [
			{ vault, requestId: 1n },
			{ vault: owner, requestId: 9n },
		],
	})
})

test('ETH recovery pays the immutable owner without arbitrary recipient or REP authority mutation calldata', () => {
	const request = buildPortfolioWithdrawEthRequest({ owner, vault })
	expect(request).toMatchObject({ account: owner, to: vault, value: 0n })
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'withdrawEth', args: [] })
})
