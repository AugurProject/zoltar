import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioMintRequest, loadPortfolioMintQuote, portfolioRecoveryMintBudget, type PortfolioReadClient } from './securityPoolPortfolio.js'

const trader: Address = '0x0000000000000000000000000000000000000001'
const portfolio: Address = '0x0000000000000000000000000000000000000002'
const pool: Address = '0x0000000000000000000000000000000000000003'
const capitalLedger: Address = '0x0000000000000000000000000000000000000004'
const abi = parseAbi(['function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumFee)'])

describe('shared capital complete-set purchases', () => {
	test('binds universe, question, outcome minimum and an explicit fee budget', () => {
		const request = buildPortfolioMintRequest({ trader, portfolio, universeId: 7n, questionId: 13n, mintAttoEth: 100n, recipient: trader, minimumShares: 99n, maximumPurchaseFeeAttoEth: 2n })
		expect(request).toMatchObject({ account: trader, to: portfolio, value: 0n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'createCompleteSet', args: [7n, 13n, 100n, trader, 99n, 2n] })
		expect(() => buildPortfolioMintRequest({ trader, portfolio, universeId: 2n ** 248n, questionId: 13n, mintAttoEth: 100n, recipient: trader, minimumShares: 99n, maximumPurchaseFeeAttoEth: 2n })).toThrow('uint248')
	})

	test('recovery-bearing mint requests bind an explicit REP budget', () => {
		const recoveryAbi = parseAbi(['function createCompleteSetWithRecoveryRep(uint248,uint256,uint256,address,uint256,uint256,uint256)'])
		const request = buildPortfolioMintRequest({ trader, portfolio, universeId: 7n, questionId: 13n, mintAttoEth: 100n, recipient: trader, minimumShares: 99n, maximumPurchaseFeeAttoEth: 2n, maximumRecoveryAttoRep: 5n })
		expect(decodeFunctionData({ abi: recoveryAbi, data: request.data })).toEqual({ functionName: 'createCompleteSetWithRecoveryRep', args: [7n, 13n, 100n, trader, 99n, 2n, 5n] })
	})

	test('quotes canonical question units and uniform purchase fees without a vault or allocation scan', async () => {
		const calls: string[] = []
		const responses: Record<string, unknown> = { getPool: pool, capitalLedger, purchaseQuote: [20n, 8n], quoteQuestionMint: 99n, availableMintCapacity: 200n, isPriceValid: true, quoteMintRecoveryRep: 0n }
		const client: PortfolioReadClient = {
			getChainId: async () => 1,
			getBlock: async () => ({ number: 45n, timestamp: 100n }),
			readContract: async parameters => {
				calls.push(parameters.functionName)
				expect(parameters.blockNumber).toBe(45n)
				return responses[parameters.functionName]
			},
		}
		expect(await loadPortfolioMintQuote({ client, portfolio, universeId: 7n, questionId: 13n, mintAttoEth: 100n })).toEqual({
			pool,
			capitalLedger,
			shares: 99n,
			purchaseFeeAttoEth: 20n,
			maximumPurchaseFeeAttoEth: 21n,
			recoveryAttoRep: 0n,
			maximumRecoveryAttoRep: 0n,
			resolutionPremiumAttoEth: 8n,
			availableCommitmentAttoEth: 200n,
			priceValid: true,
			blockNumber: 45n,
		})
		expect(calls).toHaveLength(7)
	})
})

test('recovery REP headroom is finite, rounds up, and never requests REP for an empty basket', () => {
	expect(portfolioRecoveryMintBudget(0n)).toBe(0n)
	expect(portfolioRecoveryMintBudget(5n)).toBe(7n)
	expect(portfolioRecoveryMintBudget(100n)).toBe(102n)
	expect(() => portfolioRecoveryMintBudget(-1n)).toThrow()
})
