import { expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, parseAbiParameters, type Address } from '@zoltar/core-shared/evm/ethereum'
import { reportingDepositCursorStore, searchReportingDepositsPage } from '@zoltar/ui-statoblast-shared/protocol/reportingDepositSearch.js'
import { createBlockWithTimestamp, createMulticallStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { captureReportingDeposits, reportingDepositStore } from '@zoltar/ui-statoblast-shared/protocol/reportingDeposits.js'

import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

installDomTestLifecycle()

const game: Address = '0x0000000000000000000000000000000000000011'
const wallet: Address = '0x0000000000000000000000000000000000000022'
const other: Address = '0x0000000000000000000000000000000000000033'
const abi = parseAbi(['event DepositOnOutcome(address indexed depositor, uint8 indexed outcome, uint256 amountAttoRep, uint256 depositIndex, uint256 cumulativeRepAmountAttoRep, uint256 resultingVaultDisputeStakedAttoRep, uint256 resultingTotalDisputeStakedAttoRep)'])

function deposit(address: Address, depositor: Address, index: bigint) {
	const topics = encodeEventTopics({ abi, eventName: 'DepositOnOutcome', args: { depositor, outcome: 1 } }).filter(topic => topic !== null)
	const data = encodeAbiParameters(parseAbiParameters('uint256,uint256,uint256,uint256,uint256'), [20n, index, 20n, 20n, 20n])
	return { address, topics, data }
}

test('only deposits emitted by the confirmed game and made by the reporting wallet are saved', async () => {
	const logs = [deposit(game, wallet, 7n), deposit(other, wallet, 8n), deposit(game, other, 9n), { ...deposit(game, wallet, 10n), data: '0x' as const }]
	const client = testDouble<Parameters<typeof captureReportingDeposits>[0]>({
		account: { address: wallet },
		readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber: bigint }) => {
			expect(blockNumber).toBe(42n)
			if (functionName === 'escalationGame') return game
			if (functionName === 'questionId') return 1n
			if (functionName === 'securityPoolOf') return other
			throw new Error(`Unexpected report receipt read ${functionName}`)
		},
	})
	const receipt = testDouble<Parameters<typeof captureReportingDeposits>[4]>({ logs, blockNumber: 42n })
	await captureReportingDeposits(client, MAINNET_NETWORK_PROFILE, other, 0n, receipt)
	expect(reportingDepositStore(MAINNET_NETWORK_PROFILE).read()).toEqual([{ pool: other, questionId: 1n, universeId: 0n, depositor: wallet, outcome: 'yes', index: 7n, originalAttoRep: 20n }])
})

test('search restarts at zero when the stored block was reorganized and does not save an unconfirmed cursor', async () => {
	const oldHash = keccak256('0x01')
	const currentHash = keccak256('0x02')
	const queries: Array<{ start: bigint; blockNumber: bigint | undefined }> = []
	const client = {
		getBlock: async ({ blockNumber = 10n }: { blockNumber?: bigint } = {}) => ({ ...createBlockWithTimestamp(20n), hash: currentHash, number: blockNumber }),
		multicall: createMulticallStub(request => {
			return request.contracts.map(call => {
				if (call.functionName === 'getDepositsByOutcomeLength') return { status: 'success', result: 0n }
				const start = call.args?.[1]
				if (typeof start !== 'bigint') throw new Error('Missing deposit index.')
				queries.push({ start, blockNumber: request.blockNumber })
				return { status: 'success', result: start === 0n ? [{ depositor: wallet, amountAttoRep: 10n, cumulativeAmountAttoRep: 10n }] : [] }
			})
		}),
	}
	const side = { pool: other, questionId: 1n, universeId: 0n, outcome: 'yes' as const, depositor: wallet }
	const result = await searchReportingDepositsPage(testDouble<Parameters<typeof searchReportingDepositsPage>[0]>(client), game, side, { block: 7n, hash: oldHash, nextIndex: 60n })
	expect(queries).toEqual([
		{ start: 0n, blockNumber: 10n },
		{ start: 30n, blockNumber: 10n },
	])
	expect(result.matches).toEqual([{ deposit: { ...side, index: 0n, originalAttoRep: 10n }, principal: 10n }])
	expect(result.restarted).toBe(true)
	expect(result.confirmed).toEqual({ block: 7n, hash: currentHash, nextIndex: 0n })
	expect(result.position.nextIndex).toBe(1n)
	expect(result.end).toBe(true)
})

test('a fresh device finds a wallet deposit on the second page and Search again starts from zero', async () => {
	const blockHash = keccak256('0x03')
	const starts: bigint[] = []
	const makeDeposit = (depositor: Address) => ({ depositor, amountAttoRep: 5n, cumulativeAmountAttoRep: 5n })
	const client = testDouble<Parameters<typeof searchReportingDepositsPage>[0]>({
		getBlock: async ({ blockNumber = 10n }: { blockNumber?: bigint } = {}) => ({ ...createBlockWithTimestamp(20n), hash: blockHash, number: blockNumber }),
		multicall: createMulticallStub(request => {
			return request.contracts.map(call => {
				if (call.functionName === 'getDepositsByOutcomeLength') return { status: 'success', result: 31n }
				const start = call.args?.[1]
				if (typeof start !== 'bigint') throw new Error('Missing page offset.')
				starts.push(start)
				if (start === 0n) return { status: 'success', result: Array.from({ length: 30 }, () => makeDeposit(other)) }
				return { status: 'success', result: start === 30n ? [makeDeposit(wallet)] : [] }
			})
		}),
	})
	const side = { pool: other, questionId: 5n, universeId: 0n, outcome: 'yes' as const, depositor: wallet }
	const cursor = reportingDepositCursorStore(MAINNET_NETWORK_PROFILE, side)
	expect(cursor.read()).toBeUndefined()
	const first = await searchReportingDepositsPage(client, game, side, cursor.read())
	expect(first.restarted).toBe(false)
	expect(first.totalDeposits).toBe(31n)
	expect(first.matches.map(match => match.deposit.index)).toEqual([30n])
	cursor.write(first.confirmed)
	expect(cursor.read()?.nextIndex).toBe(31n)
	cursor.write(undefined)
	await searchReportingDepositsPage(client, game, side, cursor.read())
	expect(starts).toEqual([0n, 30n, 0n, 30n])
})

test('deposit search issues at most one request at a time and batches the head count with the pages', async () => {
	const hash = keccak256('0x04')
	let active = 0
	let peak = 0
	const request = async <T>(result: T) => {
		peak = Math.max(peak, ++active)
		await Promise.resolve()
		active--
		return result
	}
	const batchedFunctions: string[][] = []
	const client = testDouble<Parameters<typeof searchReportingDepositsPage>[0]>({
		getBlock: async ({ blockNumber = 10n }: { blockNumber?: bigint } = {}) => await request({ ...createBlockWithTimestamp(20n), hash, number: blockNumber }),
		multicall: createMulticallStub(({ allowFailure, contracts }) => {
			batchedFunctions.push(contracts.map(call => call.functionName))
			return request(
				contracts.map(call => {
					const result = call.functionName === 'getDepositsByOutcomeLength' ? 0n : []
					return allowFailure ? { status: 'success', result } : result
				}),
			)
		}),
	})
	const side = { pool: other, questionId: 5n, universeId: 0n, outcome: 'yes' as const, depositor: wallet }
	await searchReportingDepositsPage(client, game, side, { block: 7n, hash, nextIndex: 0n })
	expect(peak).toBe(1)
	expect(batchedFunctions).toEqual([['getDepositsByOutcome', 'getDepositsByOutcome', 'getDepositsByOutcomeLength'], ['getDepositsByOutcomeLength']])
})
