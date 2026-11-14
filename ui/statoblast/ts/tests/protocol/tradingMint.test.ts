import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { describe, expect, mock, test } from 'bun:test'
import { decodeFunctionData, getAddress, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createBlockWithTimestamp, createMockWriteClient, asWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { createCompleteSetInSecurityPool, redeemSharesInSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { approveErc20 } from '@zoltar/ui-zoltar-shared/protocol/tokenActions.js'
import type { TransactionPlanStep, TransactionRequestPreview } from '@zoltar/ui-core-shared/wallet/chainBackend.js'

const pool = getAddress('0x00000000000000000000000000000000000000a1')

/** A portfolio-backed pool with ample collateral, approvals, and mint capacity, no escalation game, and the given question end. */
function mintClient(send: Parameters<typeof createMockWriteClient>[0], currentTimestamp: bigint, questionEndDate: bigint) {
	return {
		...asWriteClient(
			createMockWriteClient(send, async request => {
				if (request.functionName === 'collateralToken') return getActiveNetworkProfile().wethAddress
				if (request.functionName === 'services') return portfolio
				if (request.functionName === 'balanceOf' || request.functionName === 'allowance') return 10n ** 21n
				if (request.functionName === 'escalationGame') return zeroAddress
				if (request.functionName === 'universeId' || request.functionName === 'questionId') return 1n
				if (request.functionName === 'securityPoolFactory') return pool
				if (request.functionName === 'getSecurityPoolPortfolio') return portfolio
				if (request.functionName === 'getPool') return pool
				if (request.functionName === 'purchaseQuote') return [0n, 0n]
				if (request.functionName === 'availableMintCapacity' || request.functionName === 'attoEthToAttoShares') return 10n ** 18n
				if (request.functionName === 'questionData') return pool
				if (request.functionName === 'getQuestionEndDate') return questionEndDate
				throw new Error(`Unexpected read ${request.functionName}`)
			}),
		),
		account: { address: pool, type: 'json-rpc' as const },
		getBlock: async () => createBlockWithTimestamp(currentTimestamp),
	}
}

void describe('complete-set mint submission', () => {
	test.each([100n, 101n])('rejects minting at or after the question end without an escalation game (%s)', async currentTimestamp => {
		const send = mock(() => undefined)
		const client = mintClient(send, currentTimestamp, 100n)
		await expect(createCompleteSetInSecurityPool(client, pool, 10n ** 18n)).rejects.toThrow('question ended')
		expect(send).not.toHaveBeenCalled()
	})
	test.each([3540n, 10n ** 9n])('submits the selected mint amount through its portfolio at %s', async currentTimestamp => {
		const send = mock((request: { data?: `0x${string}`; value?: bigint }) => {
			expect(request.value).toBe(0n)
			if (request.data === undefined) throw new Error('Expected mint calldata')
			expect(decodeFunctionData({ abi: portfolioMintAbi, data: request.data }).functionName).toBe('createCompleteSet')
		})
		const client = mintClient(send, currentTimestamp, currentTimestamp + 1n)
		await createCompleteSetInSecurityPool(client, pool, 10n ** 18n)
		expect(send).toHaveBeenCalledTimes(1)
	})
})

const portfolio = getAddress('0x00000000000000000000000000000000000000b1')
const portfolioMintAbi = parseAbi(['function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintEth,address recipient,uint256 minimumShares,uint256 maximumFee)'])

test('winning-share redemption reviews ETH and REP recovery for the winning balance at one block', async () => {
	const unit = 10n ** 18n
	let review: TransactionRequestPreview | undefined
	const send = mock((request: { to?: unknown; data?: `0x${string}` }) => {
		expect(request.to).toBe(pool)
		if (request.data === undefined) throw new Error('Missing redemption calldata')
		expect(decodeFunctionData({ abi: parseAbi(['function redeemShares()']), data: request.data }).functionName).toBe('redeemShares')
	})
	const pinned: (bigint | undefined)[] = []
	const client = {
		...asWriteClient(
			createMockWriteClient(send, async request => {
				if (request.functionName === 'collateralToken') return getActiveNetworkProfile().wethAddress
				if (request.functionName === 'services') return portfolio
				if (request.functionName === 'balanceOf' || request.functionName === 'allowance') return 10n ** 21n
				if (request.functionName === 'universeId') return 1n
				if (request.functionName === 'securityPoolFactory') return pool
				if (request.functionName === 'getSecurityPoolPortfolio') return portfolio
				if (request.functionName === 'shareToken' || request.functionName === 'securityPoolForker') return portfolio
				pinned.push(request.blockNumber)
				if (request.functionName === 'balanceOfShares') return [unit, 2n * unit, 3n * unit]
				if (request.functionName === 'getQuestionOutcome') return 2n
				expect(request.args).toEqual([3n * unit])
				if (request.functionName === 'attoSharesToAttoEth') return unit
				if (request.functionName === 'attoSharesToAttoRep') return 2n * unit
				throw new Error(`Unexpected redemption read ${request.functionName}`)
			}),
		),
		account: { address: pool, type: 'json-rpc' as const },
		getBlock: async () => ({ ...createBlockWithTimestamp(100n), number: 99n }),
		onTransactionPrepared: (value: TransactionRequestPreview) => {
			review = value
		},
	}
	await redeemSharesInSecurityPool(client, pool)
	expect(pinned).toEqual([99n, 99n, 99n, 99n])
	expect(review?.reviewDescription).toMatch(/1\sWETH/)
	expect(review?.reviewDescription).toMatch(/2\sREP/)
	expect(send).toHaveBeenCalledTimes(1)
})

test('token approval authorizes only the requested spender and amount', async () => {
	const send = mock((request: { to?: unknown; data?: `0x${string}` }) => {
		expect(request.to).toBe(pool)
		if (request.data === undefined) throw new Error('Missing approval calldata')
		expect(decodeFunctionData({ abi: parseAbi(['function approve(address spender,uint256 amount) returns (bool)']), data: request.data })).toEqual({ functionName: 'approve', args: [portfolio, 123n] })
	})
	const result = await approveErc20(asWriteClient(createMockWriteClient(send)), pool, portfolio, 123n, 'approvePortfolioRep')
	expect(result.action).toBe('approvePortfolioRep')
	expect(send).toHaveBeenCalledTimes(1)
})

for (const mode of ['purchase', 'insufficient backing', 'child pool'] as const) {
	test(`shared mint route: ${mode}`, async () => {
		let quoteFee = 3n
		let walletBalance = 1_000n
		let timestamp = 1n
		let game = zeroAddress
		let plans: readonly TransactionPlanStep[] = []
		const send = mock((request: { to?: unknown; data?: `0x${string}`; value?: bigint }) => {
			expect(request.to).toBe(portfolio)
			expect(request.value).toBe(0n)
			if (request.data === undefined) throw new Error('Expected portfolio purchase calldata')
			expect(decodeFunctionData({ abi: portfolioMintAbi, data: request.data })).toEqual({ functionName: 'createCompleteSet', args: [1n, 7n, 100n, pool, 90n, 4n] })
		})
		const reads: string[] = []
		const client = {
			...asWriteClient(
				createMockWriteClient(send, async request => {
					if (request.functionName === 'collateralToken') return getActiveNetworkProfile().wethAddress
					if (request.functionName === 'services') return portfolio
					if (request.functionName === 'balanceOf') return walletBalance
					if (request.functionName === 'allowance') return 10n ** 21n
					reads.push(request.functionName)
					switch (request.functionName) {
						case 'escalationGame':
							return game
						case 'questionData':
						case 'securityPoolFactory':
						case 'getPool':
							return pool
						case 'getSecurityPoolPortfolio':
							return portfolio
						case 'questionId':
							return 7n
						case 'universeId':
							return 1n
						case 'originUniverseId':
							return mode === 'child pool' ? 0n : 1n
						case 'getQuestionEndDate':
							return 100n
						case 'purchaseQuote':
							expect(request.args).toEqual([1n, 7n, 100n])
							return [quoteFee, 1n]
						case 'availableMintCapacity':
							return mode === 'insufficient backing' ? 99n : 100n
						case 'attoEthToAttoShares':
							return 90n
						default:
							throw new Error(`Unexpected read ${request.functionName}`)
					}
				}),
			),
			account: { address: pool, type: 'json-rpc' as const },
			getBlock: async () => createBlockWithTimestamp(timestamp),
			getBalance: async () => walletBalance,
			estimateGas: async () => 100_000n,
			onTransactionPlan: (steps: readonly TransactionPlanStep[]) => {
				plans = steps
			},
		}
		if (mode !== 'insufficient backing') {
			await createCompleteSetInSecurityPool(client, pool, 100n)
			expect(send).toHaveBeenCalledTimes(1)
			expect(reads).not.toContain('getCurrentMintingCapacityAttoEth')
			const validate = plans[0]?.validateBeforeSubmit
			if (validate === undefined) throw new Error('Missing purchase review validation')
			await validate()
			quoteFee = 5n
			await expect(validate()).rejects.toThrow('Purchase fee changed')
			quoteFee = 3n
			walletBalance = 103n
			await expect(validate()).rejects.toThrow('Insufficient collateral')
			walletBalance = 1_000n
			timestamp = 100n
			await expect(validate()).rejects.toThrow('question ended')
			timestamp = 1n
			game = pool
			await expect(validate()).rejects.toThrow('escalation starts')
			expect(send).toHaveBeenCalledTimes(1)
		} else {
			await expect(createCompleteSetInSecurityPool(client, pool, 100n)).rejects.toThrow('Insufficient shared REP')
			expect(send).not.toHaveBeenCalled()
		}
	})
}
