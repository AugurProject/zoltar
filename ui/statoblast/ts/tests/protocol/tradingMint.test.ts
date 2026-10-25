import { describe, expect, mock, test } from 'bun:test'
import { decodeFunctionData, getAddress, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createBlockWithTimestamp, createMockWriteClient, asWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { createCompleteSetInSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/trading.js'

const pool = getAddress('0x00000000000000000000000000000000000000a1')

void describe('complete-set mint submission', () => {
	test.each([100n, 101n])('rejects minting at or after the question end without an escalation game (%s)', async currentTimestamp => {
		const send = mock(() => undefined)
		const client = {
			...asWriteClient(
				createMockWriteClient(send, async request => {
					if (request.functionName === 'escalationGame') return zeroAddress
					if (request.functionName === 'securityPoolFactory') return pool
					if (request.functionName === 'getSecurityPoolPortfolio') return '0x0000000000000000000000000000000000000000'
					if (request.functionName === 'questionData') return pool
					if (request.functionName === 'questionId' || request.functionName === 'universeId') return 1n
					if (request.functionName === 'getQuestionEndDate') return 100n
					throw new Error(`Unexpected read ${request.functionName}`)
				}),
			),
			getBlock: async () => createBlockWithTimestamp(currentTimestamp),
		}
		await expect(createCompleteSetInSecurityPool(client, pool, 10n ** 18n)).rejects.toThrow('question ended')
		expect(send).not.toHaveBeenCalled()
	})
	test.each([3540n, 10n ** 9n])('submits the selected mint amount without reading the oracle at %s', async currentTimestamp => {
		const send = mock((request: { data?: `0x${string}`; value?: bigint }) => {
			expect(request.value).toBe(10n ** 18n)
			if (request.data === undefined) throw new Error('Expected mint calldata')
			expect(decodeFunctionData({ abi: statoblast_SecurityPool_SecurityPool.abi, data: request.data }).functionName).toBe('createCompleteSet')
		})
		const client = {
			...asWriteClient(
				createMockWriteClient(send, async request => {
					if (request.functionName === 'escalationGame') return zeroAddress
					if (request.functionName === 'universeId' || request.functionName === 'questionId') return 1n
					if (request.functionName === 'securityPoolFactory') return pool
					if (request.functionName === 'getSecurityPoolPortfolio') return '0x0000000000000000000000000000000000000000'
					if (request.functionName === 'questionData') return pool
					if (request.functionName === 'getQuestionEndDate') return currentTimestamp + 1n
					throw new Error(`Unexpected read ${request.functionName}`)
				}),
			),
			getBlock: async () => createBlockWithTimestamp(currentTimestamp),
		}
		await createCompleteSetInSecurityPool(client, pool, 10n ** 18n)
		expect(send).toHaveBeenCalledTimes(1)
	})
})

const portfolio = getAddress('0x00000000000000000000000000000000000000b1')
const portfolioMintAbi = parseAbi(['function createCompleteSet(uint248 universeId,uint256 questionId,uint256 mintEth,address recipient,uint256 minimumShares) payable'])

for (const mode of ['purchase', 'insufficient backing', 'child pool'] as const) {
	test(`shared mint route: ${mode}`, async () => {
		const send = mock((request: { to?: unknown; data?: `0x${string}`; value?: bigint }) => {
			expect(request.to).toBe(portfolio)
			expect(request.value).toBe(104n)
			if (request.data === undefined) throw new Error('Expected portfolio purchase calldata')
			expect(decodeFunctionData({ abi: portfolioMintAbi, data: request.data })).toEqual({ functionName: 'createCompleteSet', args: [1n, 7n, 100n, pool, 90n] })
		})
		const reads: string[] = []
		const client = {
			...asWriteClient(
				createMockWriteClient(send, async request => {
					reads.push(request.functionName)
					switch (request.functionName) {
						case 'escalationGame':
							return zeroAddress
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
							return [3n, 1n, 2n, 0n]
						case 'availableMintCapacity':
							return mode === 'insufficient backing' ? 101n : 102n
						case 'attoEthToAttoShares':
							return 90n
						default:
							throw new Error(`Unexpected read ${request.functionName}`)
					}
				}),
			),
			account: { address: pool, type: 'json-rpc' as const },
			getBlock: async () => createBlockWithTimestamp(1n),
		}
		if (mode !== 'insufficient backing') {
			await createCompleteSetInSecurityPool(client, pool, 100n)
			expect(send).toHaveBeenCalledTimes(1)
			expect(reads).not.toContain('getCurrentMintingCapacityAttoEth')
		} else {
			await expect(createCompleteSetInSecurityPool(client, pool, 100n)).rejects.toThrow('Insufficient shared REP')
			expect(send).not.toHaveBeenCalled()
		}
	})
}
