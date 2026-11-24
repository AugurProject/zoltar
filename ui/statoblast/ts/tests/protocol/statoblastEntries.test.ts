import { expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { checkStatoblastEntries, invalidateStatoblastEntries } from '@zoltar/ui-statoblast-shared/protocol/statoblastEntries.js'
import { getInfraContractAddresses } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'

const pool: Address = '0x0000000000000000000000000000000000000011'
const foreign: Address = '0x2222222222222222222222222222222222222222'
const wallet: Address = '0x4444444444444444444444444444444444444444'
const ledger: Address = '0x0000000000000000000000000000000000000033'
const block = 42n
const multicallResult = parseAbiParameters('(bool success,bytes returnData)[]')
const errorAbi = parseAbi(['function Error(string reason)'])

function revert(reason: string): Hex {
	return encodeFunctionData({ abi: errorAbi, functionName: 'Error', args: [reason] })
}

test('entry checks authenticate pools before resolving questions and isolate the three question states', async () => {
	const factory = getInfraContractAddresses().securityPoolFactory.toLowerCase().slice(2)
	const batches: string[] = []
	const client = createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				if (!Array.isArray(params)) throw new Error('Missing multicall parameters.')
				const [call, tag] = params
				expect(tag).toBe('0x2a')
				if (method === 'eth_getCode') {
					expect([foreign, wallet]).toContain(call)
					return call === foreign ? '0x6000' : '0x'
				}
				expect(method).toBe('eth_call')
				if (typeof call?.data !== 'string') throw new Error('Missing multicall payload.')
				batches.push(call.data.toLowerCase())
				return batches.length === 1
					? encodeAbiParameters(multicallResult, [
							[
								{ success: true, returnData: encodeAbiParameters(parseAbiParameters('bool'), [true]) },
								{ success: true, returnData: encodeAbiParameters(parseAbiParameters('bool'), [false]) },
								{ success: true, returnData: encodeAbiParameters(parseAbiParameters('bool'), [false]) },
							],
						])
					: encodeAbiParameters(multicallResult, [
							[
								{ success: true, returnData: encodeAbiParameters(parseAbiParameters('address'), [ledger]) },
								{ success: false, returnData: revert('Question not registered') },
								{ success: false, returnData: revert('Question pool unavailable') },
							],
						])
			},
		}),
	})
	const result = await checkStatoblastEntries(
		client,
		[
			{ pool, questionId: 1n, universeId: 0n },
			{ pool, questionId: 2n, universeId: 0n },
			{ pool, questionId: 3n, universeId: 0n },
			{ pool: foreign, questionId: 4n, universeId: 0n },
			{ pool: wallet, universeId: 0n },
			{ pool: 'invalid', universeId: 0n },
		],
		block,
	)
	expect(result).toEqual([{ status: 'question', pool, ledger }, { status: 'unregistered-question' }, { status: 'unprepared-question' }, { status: 'non-statoblast-contract' }, { status: 'invalid-pool' }, { status: 'invalid-pool' }])
	expect(batches).toHaveLength(2)
	expect(batches[0]).toContain(factory)
	expect(batches[1]).not.toContain(foreign.slice(2))
})

test('a refresh rechecks a negative entry after another wallet prepares it', async () => {
	invalidateStatoblastEntries()
	let checks = 0
	const client = createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				expect(method).toBe('eth_call')
				if (!Array.isArray(params)) throw new Error('Missing multicall parameters.')
				const [, tag] = params
				checks++
				const result = checks % 2 === 1 ? encodeAbiParameters(parseAbiParameters('bool'), [true]) : encodeAbiParameters(parseAbiParameters('address'), [ledger])
				const noLedger = checks % 2 === 0 && tag === '0x2a'
				return encodeAbiParameters(multicallResult, [[{ success: !noLedger, returnData: noLedger ? revert('Question pool unavailable') : result }]])
			},
		}),
	})
	const target = [{ pool, questionId: 7n, universeId: 1n }]
	expect(await checkStatoblastEntries(client, target, 42n, true)).toEqual([{ status: 'unprepared-question' }])
	expect(await checkStatoblastEntries(client, target, 43n, true)).toEqual([{ status: 'question', pool, ledger }])
	expect(await checkStatoblastEntries(client, target, 44n, true)).toEqual([{ status: 'question', pool, ledger }])
	expect(checks).toBe(4)
})
