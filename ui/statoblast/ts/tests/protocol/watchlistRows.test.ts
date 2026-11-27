import { expect, test } from 'bun:test'
import { keccak256, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createBlockWithTimestamp, createMulticallStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { decodeWatchlistRows, loadWatchlistRows, type WatchlistEntity } from '@zoltar/ui-statoblast-shared/protocol/watchlistRows.js'
import { getInfraContractAddresses } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'

const pool: Address = '0x1111111111111111111111111111111111111111'
const secondPool: Address = '0x2222222222222222222222222222222222222222'
const foreign: Address = '0x3333333333333333333333333333333333333333'
const controller: Address = '0x4444444444444444444444444444444444444444'
const secondController: Address = '0x5555555555555555555555555555555555555555'
const ledger: Address = '0x6666666666666666666666666666666666666666'
const otherLedger: Address = '0x7777777777777777777777777777777777777777'
const owner: Address = '0x8888888888888888888888888888888888888888'
const hash = keccak256('0x01')

test('saved questions and pools share a block-pinned fork read before reading a wallet’s selected branch', async () => {
	const batches: string[][] = []
	const entries: WatchlistEntity[] = [
		{ kind: 'pool', id: pool, pool },
		{ kind: 'pool', id: secondPool, pool: secondPool },
		{ kind: 'pool', id: foreign, pool: foreign },
		{ kind: 'question', id: `${pool}:1`, pool, questionId: 1n },
		{ kind: 'question', id: `${pool}:2`, pool, questionId: 2n },
	]
	const infrastructure = getInfraContractAddresses(MAINNET_NETWORK_PROFILE)
	const client = testDouble<Parameters<typeof loadWatchlistRows>[0]>({
		getBlock: async () => ({ ...createBlockWithTimestamp(10n), number: 15n, hash }),
		getCode: async (request: { address: Address }) => {
			expect(request.address).toBe(foreign)
			return undefined
		},
		multicall: createMulticallStub(({ blockNumber, contracts }) => {
			expect(blockNumber).toBe(15n)
			batches.push(contracts.map(call => call.functionName))
			const result = (value: unknown) => ({ status: 'success', result: value })
			return contracts.map(call => {
				expect(call.address).not.toBe(foreign)
				switch (call.functionName) {
					case 'isSecurityPool':
						expect(call.address).toBe(getInfraContractAddresses().securityPoolFactory)
						return result(call.args?.[0] !== foreign)
					case 'getQuestionLedger':
						expect(call.address).toBe(pool)
						return result(call.args?.[0] === 1n ? ledger : otherLedger)
					case 'universes':
						expect(call.address).toBe(infrastructure.zoltar)
						return result([8n, 1n, 0n, zeroAddress, 0n])
					case 'getForkChoiceDeadline':
						return result(20n)
					case 'forkController':
						return result(call.address === pool ? controller : secondController)
					case 'choices':
						expect(call.args).toEqual([0n, owner])
						return result([2n, call.address === controller])
					case 'getAnswerOptionName':
						expect(call.args).toEqual([1n, 2n])
						return result('No')
					case 'getChildUniverseId':
						return result(7n)
					case 'branches':
						expect(call.address).toBe(controller)
						return result([0n, 2n, 0n, 0n, 0n, 0n, true, false, false, zeroAddress, 0n])
					case 'annualFeeBps':
					case 'purchaseFeeBps':
					case 'minimumPurchaseFeeAttoEth':
						return result(0n)
					case 'questions':
						return result(['Saved question', '', 0n, 4n])
					case 'getQuestionOutcome':
						return result(call.args?.[0] === ledger ? 3 : 2)
					default:
						return result(zeroAddress)
				}
			})
		}),
	})
	const rows = await loadWatchlistRows(client, entries, 0n, owner, MAINNET_NETWORK_PROFILE)
	expect(rows).toMatchObject([
		{ forkedAt: 8n, forkChoiceDeadline: 20n, forkChoiceRecorded: true, forkChoiceOutcome: 'No', forkChildUniverse: 7n, forkBranchStarted: false, forkBranchReady: false },
		{ forkedAt: 8n, forkChoiceDeadline: 20n, forkChoiceRecorded: false },
		{ status: 'invalid-pool' },
		{ forkedAt: 8n, forkQuestionId: 1n, question: { universeHasForked: true, questionOutcome: 'none' } },
		{ forkedAt: 8n, forkQuestionId: 1n, question: { universeHasForked: true, questionOutcome: 'no' } },
	])
	expect(batches.flat().filter(call => call === 'universes')).toHaveLength(1)
	expect(batches.flat().filter(call => call === 'getForkChoiceDeadline')).toHaveLength(1)
	expect(batches.findIndex(batch => batch.includes('forkController'))).toBeGreaterThan(batches.findIndex(batch => batch.includes('isSecurityPool')))
	expect(batches.findIndex(batch => batch.includes('choices'))).toBeGreaterThan(batches.findIndex(batch => batch.includes('forkController')))
	expect(decodeWatchlistRows(rows)?.[0]).toMatchObject({ forkChoiceOutcome: 'No', forkChildUniverse: 7n, forkBranchStarted: false })
})
