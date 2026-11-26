import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, decodeFunctionData, parseAbi, zeroHash, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolMintRequest, loadSecurityPoolMintQuote, securityPoolRecoveryMintBudget, type SecurityPoolReadClient } from './securityPool.js'

const trader: Address = '0x0000000000000000000000000000000000000001'
const securityPool: Address = '0x0000000000000000000000000000000000000002'
const pool: Address = '0x0000000000000000000000000000000000000003'
const capitalLedger: Address = '0x0000000000000000000000000000000000000004'
const abi = parseAbi(['function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintAttoEth,address recipient,uint256 minimumShares,uint256 maximumFee)'])

describe('shared capital complete-set purchases', () => {
	test('binds universe, question, outcome minimum and an explicit fee budget', () => {
		const request = buildSecurityPoolMintRequest({ trader, securityPool, universeId: 7n, questionId: 13n, mintAttoEth: 100n, recipient: trader, minimumShares: 99n, maximumPurchaseFeeAttoEth: 2n })
		expect(request).toMatchObject({ account: trader, to: securityPool, value: 0n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'createCompleteSet', args: [7n, 13n, 100n, trader, 99n, 2n] })
		expect(() => buildSecurityPoolMintRequest({ trader, securityPool, universeId: 2n ** 248n, questionId: 13n, mintAttoEth: 100n, recipient: trader, minimumShares: 99n, maximumPurchaseFeeAttoEth: 2n })).toThrow('Universe ID is out of range.')
	})

	test('recovery-bearing mint requests bind an explicit REP budget', () => {
		const recoveryAbi = parseAbi(['function createCompleteSetWithRecoveryRep(uint248,uint256,uint256,address,uint256,uint256,uint256)'])
		const request = buildSecurityPoolMintRequest({ trader, securityPool, universeId: 7n, questionId: 13n, mintAttoEth: 100n, recipient: trader, minimumShares: 99n, maximumPurchaseFeeAttoEth: 2n, maximumRecoveryAttoRep: 5n })
		expect(decodeFunctionData({ abi: recoveryAbi, data: request.data })).toEqual({ functionName: 'createCompleteSetWithRecoveryRep', args: [7n, 13n, 100n, trader, 99n, 2n, 5n] })
	})

	test('quotes attainable shares after the holding-fee checkpoint (#1733)', async () => {
		const calls: string[] = []
		const responses: Record<string, unknown> = { questionOriginIds: `0x${'11'.repeat(32)}`, getQuestionLedger: pool, capitalLedger, purchaseQuote: [20n, 8n], quoteQuestionMint: 99n, availableMintCapacity: 200n, isPriceValid: true, quoteMintRecoveryRep: 0n }
		const client = {
			multicall: createPublicClient({
				transport: custom({
					request: async () =>
						encodeAbiParameters(
							[{ type: 'tuple[]', components: [{ type: 'bool' }, { type: 'bytes' }] }],
							[
								[
									[true, '0x'],
									[true, encodeAbiParameters([{ type: 'uint256' }], [101n])],
								],
							],
						),
				}),
			}).multicall,
			getChainId: async () => 1,
			getBlock: async () => ({ number: 45n, timestamp: 100n }),
			readContract: async (parameters: Parameters<SecurityPoolReadClient['readContract']>[0]) => {
				calls.push(parameters.functionName)
				expect(parameters.blockNumber).toBe(45n)
				return responses[parameters.functionName]
			},
		}
		expect(await loadSecurityPoolMintQuote({ client, multicallAddress: trader, securityPool, universeId: 7n, questionId: 13n, mintAttoEth: 100n })).toEqual({
			pool,
			capitalLedger,
			shares: 101n,
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
	expect(securityPoolRecoveryMintBudget(0n)).toBe(0n)
	expect(securityPoolRecoveryMintBudget(5n)).toBe(7n)
	expect(securityPoolRecoveryMintBudget(100n)).toBe(102n)
	expect(() => securityPoolRecoveryMintBudget(-1n)).toThrow()
})

test('quotes an unregistered origin question without reading a nonexistent pool', async () => {
	const calls: string[] = []
	const client = {
		multicall: createPublicClient({
			transport: custom({
				request: async () => {
					throw new Error('Unregistered quote must not checkpoint')
				},
			}),
		}).multicall,
		getChainId: async () => 1,
		getBlock: async () => ({ number: 45n, timestamp: 100n }),
		readContract: async (parameters: Parameters<SecurityPoolReadClient['readContract']>[0]) => {
			calls.push(parameters.functionName)
			const responses: Record<string, unknown> = { questionOriginIds: zeroHash, originUniverseId: 7n, capitalLedger, purchaseQuote: [20n, 8n], availableMintCapacity: 200n, isPriceValid: true, quoteMintRecoveryRep: 0n }
			if (!(parameters.functionName in responses)) throw new Error(`Unexpected read ${parameters.functionName}`)
			return responses[parameters.functionName]
		},
	}
	const quote = await loadSecurityPoolMintQuote({ client, multicallAddress: trader, securityPool, universeId: 7n, questionId: 13n, mintAttoEth: 100n })
	expect(quote).toMatchObject({ pool: zeroAddress, shares: 100n, purchaseFeeAttoEth: 20n, availableCommitmentAttoEth: 200n })
	expect(calls).not.toContain('getQuestionLedger')
	expect(calls).not.toContain('quoteQuestionMint')
	await expect(loadSecurityPoolMintQuote({ client, multicallAddress: trader, securityPool, universeId: 8n, questionId: 13n, mintAttoEth: 100n })).rejects.toThrow('origin universe')
})
