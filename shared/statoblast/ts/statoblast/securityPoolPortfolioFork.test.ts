import { expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, zeroAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioSharedForkChoiceRequest, buildPortfolioSharedForkRevokeRequest, buildPortfolioSharedForkProcessRequest, buildPortfolioSharedForkRecoveryRequest, buildPortfolioContextPositionClaimRequest, loadPortfolioSharedForkSnapshot, loadPortfolioSharedForkPosition } from './securityPoolPortfolioFork.js'
import type { PortfolioReadClient } from './securityPoolPortfolioRead.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const portfolio: Address = '0x0000000000000000000000000000000000000002'
const controller: Address = '0x0000000000000000000000000000000000000003'
const ledger: Address = '0x0000000000000000000000000000000000000004'
const token: Address = '0x0000000000000000000000000000000000000005'
const factory: Address = '0x0000000000000000000000000000000000000006'
const originId = '0x0000000000000000000000000000000000000000000000000000000000000099'
const abi = parseAbi([
	'function chooseSharedFork(uint256,uint256[],uint256)',
	'function revokeSharedFork(uint256,uint256[])',
	'function processForkPosition(uint256,uint256,uint256)',
	'function claimForkRecovered(uint256,uint256[],uint256[])',
	'function claimPosition(uint256,uint256,uint256)',
	'function claimPositionAndMigrate(uint256,uint256,uint256,uint256)',
])
const request = { owner, controller, contextId: 7n }

function reads() {
	const state = { chainId: 1, intervalCount: 130n, processed: false, custody: zeroAddress, blockHash: zeroHash, pool: token, recoveryComplete: false, originId, factoryUnavailable: false }
	const calls: Parameters<PortfolioReadClient['readContract']>[0][] = []
	const client: PortfolioReadClient = {
		getChainId: async () => state.chainId,
		getBlock: async () => ({ number: 51n, hash: state.blockHash, timestamp: 3_000_000n }),
		readContract: async call => {
			calls.push(call)
			switch (call.functionName) {
				case 'forkController':
					return controller
				case 'contextCount':
					return 10n
				case 'getContext':
					return { universeId: 100n, parentContextId: 0n, outcomeIndex: 37n, incomingActivationFloor: 1_000_000n, ledger, repToken: token, pointCount: 100_000n }
				case 'choiceWindow':
					return [1_000_000n, 2_000_000n]
				case 'getOwnerIntervalCount':
					return state.intervalCount
				case 'getOwnerInterval':
					return { generation: 1n, startPosition: 1n, endPosition: 100_000n, shares: 7n, repIndex: 0n, feeIndex: 0n, open: false, active: true }
				case 'choices':
					return [true, 37n, 3n]
				case 'previewClaim':
					return [13n, 17n]
				case 'childContextIds':
					return 8n
				case 'readPosition':
					return { custody: state.custody, remainingShares: 7n, unmigratedShares: 7n, recoveryComplete: state.recoveryComplete }
				case 'processedPositions':
					return state.processed
				case 'positions':
					return [901n, 10n, 7n, owner]
				case 'getBranchWeight':
					return 3n
				case 'getPool':
					if (state.pool === zeroAddress) throw new Error('Question pool unavailable')
					return state.pool
				case 'factory':
					return factory
				case 'questionOriginIds':
					return state.originId
				case 'getSecurityPool':
					if (state.factoryUnavailable) throw new Error('Factory RPC unavailable')
					return state.pool
				default:
					throw new Error(`Unexpected shared fork read ${call.functionName}`)
			}
		},
	}
	return { client, state, calls }
}

test('shared choice binds an owner and context, normalizes only their supplied intervals, and preserves arbitrary fork outcomes', () => {
	const built = buildPortfolioSharedForkChoiceRequest({ ...request, intervalIds: [9n, 1n, 9n, 0n], outcomeIndex: 37n })
	expect(built).toMatchObject({ account: owner, to: controller, value: 0n })
	expect(decodeFunctionData({ abi, data: built.data })).toEqual({ functionName: 'chooseSharedFork', args: [7n, [0n, 1n, 9n], 37n] })
	expect(decodeFunctionData({ abi, data: buildPortfolioSharedForkRevokeRequest({ ...request, intervalIds: [8n, 1n] }).data }).args).toEqual([7n, [1n, 8n]])
	expect(() => buildPortfolioSharedForkChoiceRequest({ ...request, intervalIds: [], outcomeIndex: 1n })).toThrow('ownership interval')
	expect(() => buildPortfolioSharedForkChoiceRequest({ ...request, intervalIds: [0n], outcomeIndex: 1n << 256n })).toThrow('uint256')
})

test('processing selects one allocation and collection can make zero-payout progress without caller-owned intervals', () => {
	expect(decodeFunctionData({ abi, data: buildPortfolioSharedForkProcessRequest({ ...request, positionId: 99n, outcomeIndex: 37n }).data })).toEqual({ functionName: 'processForkPosition', args: [7n, 99n, 37n] })
	expect(decodeFunctionData({ abi, data: buildPortfolioSharedForkRecoveryRequest({ ...request, intervalIds: [], positionIds: [9n, 5n, 9n] }).data })).toEqual({ functionName: 'claimForkRecovered', args: [7n, [], [5n, 9n]] })
	expect(decodeFunctionData({ abi, data: buildPortfolioSharedForkRecoveryRequest({ ...request, intervalIds: [0n] }).data }).args).toEqual([7n, [0n], []])
	expect(() => buildPortfolioSharedForkProcessRequest({ ...request, positionId: 0n, outcomeIndex: 1n })).toThrow('allocation position')
	expect(() => buildPortfolioSharedForkRecoveryRequest({ ...request, intervalIds: [], positionIds: [0n] })).toThrow('allocation position')
})

test('individual fallback preserves context identity and only includes a branch when explicitly chosen', () => {
	expect(decodeFunctionData({ abi, data: buildPortfolioContextPositionClaimRequest({ ...request, positionId: 4n, intervalId: 0n }).data })).toEqual({ functionName: 'claimPosition', args: [7n, 4n, 0n] })
	expect(decodeFunctionData({ abi, data: buildPortfolioContextPositionClaimRequest({ ...request, positionId: 4n, intervalId: 0n, outcomeIndex: 0n }).data })).toEqual({ functionName: 'claimPositionAndMigrate', args: [7n, 4n, 0n, 0n] })
})

test('a shared snapshot reads one bounded personal page independent of global allocation and owner counts', async () => {
	const { client, calls } = reads()
	const snapshot = await loadPortfolioSharedForkSnapshot({ client, portfolio, owner, contextId: 7n, intervalStart: 128n, outcomeIndex: 37n })
	expect(snapshot).toMatchObject({ contextId: 7n, controller, universeId: 100n, repToken: token, positionCount: 100_000n, recoverableRepAttoRep: 13n, recoverableFeesAttoEth: 17n, childContextId: 8n })
	expect(snapshot.intervals.map(interval => interval.intervalId)).toEqual([128n, 129n])
	expect(snapshot.intervals[0]).toMatchObject({ selected: true, outcomeIndex: 37n, childIntervalId: 3n })
	expect(calls.filter(call => call.functionName === 'getOwnerInterval')).toHaveLength(2)
	expect(calls.find(call => call.functionName === 'previewClaim')?.args).toEqual([owner, [128n, 129n]])
	expect(calls.every(call => call.blockNumber === 51n)).toBe(true)
	expect(calls.some(call => call.functionName === 'positions' || call.functionName === 'getQuestions' || call.functionName === 'getVaults')).toBe(false)
	await expect(loadPortfolioSharedForkSnapshot({ client, portfolio, owner, contextId: 10n })).rejects.toThrow('existing fork context')
	await expect(loadPortfolioSharedForkSnapshot({ client, portfolio, owner, contextId: 7n, intervalStart: 131n })).rejects.toThrow('out of bounds')
})

test('first history page remains bounded and only saved personal branches are linked', async () => {
	const { client, calls } = reads()
	const snapshot = await loadPortfolioSharedForkSnapshot({ client, portfolio, owner, contextId: 0n })
	expect(snapshot.intervals).toHaveLength(64)
	expect(snapshot.childContextId).toBe(0n)
	expect(calls.filter(call => call.functionName === 'childContextIds').map(call => call.args)).toEqual([[0n, 37n]])
	expect(snapshot.branches).toEqual([{ outcomeIndex: 37n, contextId: 8n }])
	expect(calls.filter(call => call.functionName === 'getOwnerInterval')).toHaveLength(64)
})

test('selected allocation readiness keeps unmaterialized rights distinct from already processed branches', async () => {
	const { client, state, calls } = reads()
	const snapshot = await loadPortfolioSharedForkSnapshot({ client, portfolio, owner, contextId: 7n, intervalStart: 128n, outcomeIndex: 37n })
	calls.length = 0
	expect(await loadPortfolioSharedForkPosition({ client, snapshot, positionId: 99n, outcomeIndex: 37n })).toMatchObject({ positionId: 99n, questionId: 901n, custody: zeroAddress, branchProcessed: false, branchWeight: 3n })
	expect(calls.map(call => call.functionName).sort()).toEqual(['getBranchWeight', 'factory', 'questionOriginIds', 'getSecurityPool', 'positions', 'processedPositions', 'readPosition'].sort())
	state.processed = true
	expect((await loadPortfolioSharedForkPosition({ client, snapshot, positionId: 99n, outcomeIndex: 37n })).branchProcessed).toBe(true)
	await expect(loadPortfolioSharedForkPosition({ client, snapshot, positionId: 100_001n })).rejects.toThrow('allocation in this fork context')
	await expect(loadPortfolioSharedForkPosition({ client, snapshot, positionId: 99n, outcomeIndex: 38n })).rejects.toThrow('snapshot for this outcome')
	state.chainId = 2
	await expect(loadPortfolioSharedForkPosition({ client, snapshot, positionId: 99n })).rejects.toThrow('Chain changed')
})

test('a snapshot changing chain anchors cannot authorize choices or recovery', async () => {
	const { client } = reads()
	let checks = 0
	client.getChainId = async () => ++checks
	await expect(loadPortfolioSharedForkSnapshot({ client, portfolio, owner, contextId: 0n })).rejects.toThrow('Chain changed')
})

test('an enrolled child position can have neither pool nor custody, including a completed source hole', async () => {
	const { client, state, calls } = reads()
	state.pool = zeroAddress
	const snapshot = await loadPortfolioSharedForkSnapshot({ client, portfolio, owner, contextId: 7n, intervalStart: 128n })
	calls.length = 0
	expect(await loadPortfolioSharedForkPosition({ client, snapshot, positionId: 99n })).toMatchObject({ pool: zeroAddress, custody: zeroAddress, recoveryComplete: false })
	expect(calls.find(call => call.functionName === 'getSecurityPool')).toMatchObject({ address: factory, args: [originId, 100n], blockNumber: 51n })
	expect(calls.some(call => call.functionName === 'getPool')).toBe(false)
	expect(calls.every(call => call.blockNumber === 51n)).toBe(true)
	state.recoveryComplete = true
	expect(await loadPortfolioSharedForkPosition({ client, snapshot, positionId: 99n })).toMatchObject({ pool: zeroAddress, custody: zeroAddress, recoveryComplete: true })
	state.factoryUnavailable = true
	await expect(loadPortfolioSharedForkPosition({ client, snapshot, positionId: 99n })).rejects.toThrow('Factory RPC unavailable')
	state.factoryUnavailable = false
	state.originId = zeroHash
	await expect(loadPortfolioSharedForkPosition({ client, snapshot, positionId: 99n })).rejects.toThrow('Question not registered')
})
