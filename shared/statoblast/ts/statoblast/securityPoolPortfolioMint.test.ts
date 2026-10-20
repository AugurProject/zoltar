import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioMintRequest, loadPortfolioMintQuote, type PortfolioReadClient } from './securityPoolPortfolio.js'

const trader: Address = '0x0000000000000000000000000000000000000001'
const portfolio: Address = '0x0000000000000000000000000000000000000002'
const pool: Address = '0x0000000000000000000000000000000000000003'
const capitalLedger: Address = '0x0000000000000000000000000000000000000004'
const abi = parseAbi(['function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares) payable'])

describe('shared capital complete-set purchases', () => {
	test('binds universe, question, outcome minimum and an explicit fee budget', () => {
		const request = buildPortfolioMintRequest({ trader, portfolio, universeId: 7n, questionId: 13n, mintAttoEth: 100n, recipient: trader, minimumShares: 99n, maximumPurchaseFeeAttoEth: 2n })
		expect(request).toMatchObject({ account: trader, to: portfolio, value: 102n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'createCompleteSet', args: [7n, 13n, 100n, trader, 99n] })
		expect(() => buildPortfolioMintRequest({ trader, portfolio, universeId: 2n ** 248n, questionId: 13n, mintAttoEth: 100n, recipient: trader, minimumShares: 99n, maximumPurchaseFeeAttoEth: 2n })).toThrow('uint248')
	})

	test('quotes canonical question units and uniform purchase fees without a vault or allocation scan', async () => {
		const calls: string[] = []
		const responses: Record<string, unknown> = { getPool: pool, capitalLedger, purchaseFee: 2n, quoteQuestionMint: 99n, availableMintCapacity: 200n, isPriceValid: true }
		const client: PortfolioReadClient = {
			getChainId: async () => 1,
			getBlock: async () => ({ number: 45n, timestamp: 100n }),
			readContract: async parameters => {
				calls.push(parameters.functionName)
				expect(parameters.blockNumber).toBe(45n)
				return responses[parameters.functionName]
			},
		}
		expect(await loadPortfolioMintQuote({ client, portfolio, universeId: 7n, questionId: 13n, mintAttoEth: 100n })).toEqual({ pool, capitalLedger, shares: 99n, purchaseFeeAttoEth: 2n, availableCommitmentAttoEth: 200n, priceValid: true, blockNumber: 45n })
		expect(calls).toHaveLength(6)
	})
})
