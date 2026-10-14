import { describe, expect, test } from 'bun:test'
import { type AbiValue, type Address, type Hex, encodeAbiParameters, encodeEventTopics, getAddress, toHex, zeroAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { planPortfolioAllocations } from './securityPoolPortfolioPlanning.js'
import { loadPortfolioSnapshot, type PortfolioReadClient } from './securityPoolPortfolioRead.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const vault: Address = '0x0000000000000000000000000000000000000002'
const portfolio: Address = '0x0000000000000000000000000000000000000003'
const factory: Address = '0x0000000000000000000000000000000000000004'
const pool: Address = '0x0000000000000000000000000000000000000005'
const token: Address = '0x0000000000000000000000000000000000000006'
const childToken: Address = '0x0000000000000000000000000000000000000007'
const zoltar: Address = '0x0000000000000000000000000000000000000008'
const coordinator: Address = '0x0000000000000000000000000000000000000009'
const hash: Hex = `0x${'11'.repeat(32)}`

function operationLog(request: Parameters<NonNullable<PortfolioReadClient['getLogs']>>[0], roles: { operator: Address; receiverVault: Address; targetVault: Address }, operationId = 8n) {
	const values: Record<string, AbiValue> = {
		...roles,
		operationId,
		operation: 0n,
		operationValue: 1n,
		queuedAt: 900n,
		validForSeconds: 100n,
		snapshotTargetBackingUnits: 0n,
		snapshotTargetUnderwritingLimitAttoEth: 0n,
		snapshotTargetOpenInterestAttoEth: 0n,
		snapshotTargetDisputeStakedAttoRep: 0n,
		snapshotTotalPoolHeldAttoRep: 0n,
		snapshotTotalRepBackingUnits: 0n,
		isPendingSlot: false,
		approvalId: zeroHash,
		requestedDebtAttoEth: 1n,
		reservedDebtAttoEth: 0n,
	}
	const unindexed = request.event.inputs.filter(input => !input.indexed)
	const data = encodeAbiParameters(
		unindexed,
		unindexed.map(input => {
			const value = values[input.name ?? '']
			if (value === undefined) throw new Error('Missing event fixture value.')
			return value
		}),
	)
	const topics = encodeEventTopics({ abi: [request.event], eventName: request.event.name, args: values }).map(topic => {
		if (typeof topic !== 'string') throw new Error('Expected a concrete event topic.')
		return topic
	})
	return { address: coordinator, data, topics }
}

function fixture(
	options: { questionCount?: bigint; operationCount?: bigint; reorg?: boolean; unrelatedOwner?: boolean; omitPage?: boolean; forgedOrigin?: boolean; wrongPoolQuestion?: boolean; wrongPoolUniverse?: boolean; resolved?: boolean; game?: Address; forkContinuation?: unknown; totalDisputeStakedAttoRep?: bigint } = {},
) {
	const reads: { functionName: string; blockNumber: bigint }[] = []
	const client: PortfolioReadClient = {
		getChainId: async () => 1,
		getBlock: async parameters => ({ number: parameters?.blockNumber ?? 123n, hash: options.reorg && parameters ? `0x${'22'.repeat(32)}` : hash, timestamp: 1000n }),
		readContract: async ({ address, functionName, args = [], blockNumber }) => {
			reads.push({ functionName, blockNumber })
			switch (functionName) {
				case 'owner':
					return owner
				case 'portfolio':
					return options.unrelatedOwner ? owner : portfolio
				case 'factory':
					return factory
				case 'originUniverseId':
					return 0n
				case 'allocatedQuestionCount':
					return 0n
				case 'questionCount':
					return options.questionCount ?? 1n
				case 'getQuestions':
					return options.omitPage ? [] : [51n]
				case 'questionOriginIds':
					if (args[0] !== 51n) return `0x${'0'.repeat(64)}`
					return options.forgedOrigin ? `0x${'33'.repeat(32)}` : hash
				case 'getPortfolioOriginId':
					expect(address).toBe(factory)
					expect(args).toEqual([portfolio, 0n, 51n, 20_000n, 3n])
					return hash
				case 'initialReportPriorityFeeAttoEthPerGas':
					return 3n
				case 'getSecurityPool':
					return args[1] === 0n ? pool : zeroAddress
				case 'zoltar':
					return zoltar
				case 'getRepToken':
					return args[0] === 0n ? token : childToken
				case 'balanceOf':
					return address === token ? 20n : 90n
				case 'getForkTime':
					return args[0] === 0n ? 5n : 0n
				case 'questionId':
					return options.wrongPoolQuestion ? 52n : 51n
				case 'universeId':
					return options.wrongPoolUniverse ? 7n : 0n
				case 'repToken':
					return token
				case 'openOraclePriceCoordinator':
				case 'priceFeed':
					return coordinator
				case 'questionData':
					return zoltar
				case 'escalationGame':
					return options.game ?? zeroAddress
				case 'forkContinuation':
					return options.forkContinuation ?? false
				case 'totalDisputeStakedAttoRep':
					return options.totalDisputeStakedAttoRep ?? 0n
				case 'disputeStakedRepByVaultAttoRep':
					return 0n
				case 'securityVaults':
					return [3n, 4n, 5n, 6n]
				case 'getTotalPoolHeldAttoRep':
					return 10n
				case 'totalRepBackingUnits':
					return 6n
				case 'totalUnderwritingLimitAttoEth':
					return 7n
				case 'settlementCollateralAttoEth':
					return 2n
				case 'getVaultOpenInterestAttoEth':
					return 1n
				case 'vaultBadDebtAttoEth':
					return 0n
				case 'statoblastSecurityMultiplierBps':
					return 20_000n
				case 'minimumVaultRepDepositAttoRep':
					return 1n
				case 'systemState':
					return 0n
				case 'isEscalationResolved':
					return options.resolved ?? false
				case 'getQuestionEndDate':
					return 2000n
				case 'lastPrice':
					return 10n ** 18n
				case 'isPriceValid':
					return true
				case 'pendingReportId':
					return 0n
				case 'settlementTime':
					return 60n
				case 'getActiveStagedOperationCount':
					return options.operationCount ?? 1n
				case 'getActiveStagedOperations':
					return [[8n], [{ operation: 0n, operator: owner, receiverVault: owner, targetVault: vault, queuedAt: 900n, validForSeconds: 100n }]]
				default:
					throw new Error(`Unexpected snapshot method ${functionName}`)
			}
		},
	}
	return { client, reads, parameters: { client, portfolio, vault, universeIds: [0n, 7n] } }
}

function filteredFixture(options: { role?: 'operator' | 'receiverVault' | 'targetVault'; consumed?: boolean; failLogs?: boolean; malformedLog?: boolean; foreignLog?: boolean; foreignOperation?: boolean; zeroId?: boolean; reorg?: boolean } = {}) {
	const { parameters, client, reads } = fixture({ operationCount: 300n, reorg: options.reorg ?? false })
	const roles = { operator: owner, receiverVault: owner, targetVault: owner, ...(options.role === undefined ? {} : { [options.role]: vault }) }
	const logReads: Parameters<NonNullable<PortfolioReadClient['getLogs']>>[0][] = []
	const filteredClient: PortfolioReadClient = {
		...client,
		getLogs: async request => {
			logReads.push(request)
			if (options.failLogs) throw new Error('History unavailable.')
			if (options.role === undefined || request.args[options.role] !== vault) return []
			const log = operationLog(request, roles, options.zeroId ? 0n : 8n)
			return [{ ...log, ...(options.malformedLog ? { data: '0x' as const } : {}), ...(options.foreignLog ? { address: owner } : {}) }]
		},
		readContract: async request => {
			if (request.functionName === 'getForkTime') return 0n
			if (request.functionName === 'securityVaults') return [0n, 0n, 0n, 0n]
			if (request.functionName === 'getActiveStagedOperations') return [[options.role === 'targetVault' ? 8n : 9n], [{ operation: 0n, operator: owner, receiverVault: owner, targetVault: options.role === 'targetVault' ? vault : owner, queuedAt: 900n, validForSeconds: 100n }]]
			if (request.functionName === 'stagedOperations') {
				reads.push({ functionName: request.functionName, blockNumber: request.blockNumber })
				const operator = options.foreignOperation ? owner : roles.operator
				return [0n, options.consumed ? zeroAddress : operator, options.foreignOperation ? owner : roles.receiverVault, options.foreignOperation ? owner : roles.targetVault, 1n, 900n, 100n, 0n, 0n, zeroHash, 0n]
			}
			return client.readContract(request)
		},
	}
	return { reads, logReads, parameters: { ...parameters, client: filteredClient, universeIds: [0n], maximumOperations: 1 } }
}

function allocatedFixture(total = 400n) {
	const { parameters, client } = fixture({ questionCount: 100_000n, operationCount: 0n })
	const pages: { functionName: string; args: readonly AbiValue[]; blockNumber: bigint }[] = []
	const readContract: PortfolioReadClient['readContract'] = async request => {
		const args = request.args ?? []
		if (request.functionName === 'allocatedQuestionCount') return total
		if (request.functionName === 'getQuestions') {
			pages.push({ functionName: request.functionName, args, blockNumber: request.blockNumber })
			return [51n]
		}
		if (request.functionName === 'getAllocatedQuestions') {
			pages.push({ functionName: request.functionName, args, blockNumber: request.blockNumber })
			const [start, count] = args
			if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected allocated question page bounds.')
			return Array.from({ length: Number(count) }, (_, index) => start + BigInt(index) + 51n)
		}
		if (request.functionName === 'questionOriginIds' || request.functionName === 'getPortfolioOriginId') {
			const questionId = args[request.functionName === 'questionOriginIds' ? 0 : 2]
			if (typeof questionId !== 'bigint') throw new Error('Expected an origin question.')
			return toHex(questionId, { size: 32 })
		}
		if (request.functionName === 'getSecurityPool') {
			const origin = args[0]
			if (typeof origin !== 'string') throw new Error('Expected an origin id.')
			return args[1] === 0n ? getAddress(toHex(BigInt(origin) + 1000n, { size: 20 })) : zeroAddress
		}
		if (request.functionName === 'questionId') return BigInt(request.address) - 1000n
		return client.readContract(request)
	}
	return { pages, parameters: { ...parameters, client: { ...client, readContract } } }
}

describe('portfolio snapshot reader', () => {
	test('pins all dependent reads and keeps child REP separate without inventing a child pool', async () => {
		const { parameters, reads } = fixture()
		const snapshot = await loadPortfolioSnapshot(parameters)
		expect(snapshot.blockNumber).toBe(123n)
		expect(snapshot.branches[0]?.positions[0]).toMatchObject({ priceFeed: coordinator, pendingReportCoordinator: zeroAddress })
		expect(snapshot.coverage).toEqual({ complete: true, issues: [], scope: 'registered-and-explicit-pools', registryComplete: true })
		expect(snapshot.branches.map(branch => [branch.universeId, branch.repToken, branch.idleAttoRep, branch.positions.length])).toEqual([
			[0n, token, 20n, 1],
			[7n, childToken, 90n, 0],
		])
		expect(snapshot.branches[0]?.positions[0]?.backingAttoRep).toBe(5n)
		expect(snapshot.branches[0]?.positions[0]?.queuedOperations[0]?.operationId).toBe(8n)
		expect(snapshot.branches[0]?.positions[0]?.queuedOperationsComplete).toBe(true)
		expect(snapshot.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(true)
		expect(reads.length).toBeGreaterThan(25)
		expect(reads.every(read => read.blockNumber === 123n)).toBe(true)
	})

	test('rejects forged origin storage even when the substituted pool has the same question and universe', async () => {
		await expect(loadPortfolioSnapshot(fixture({ forgedOrigin: true }).parameters)).rejects.toThrow('Portfolio question origin mismatch')
	})

	test('checks the selected native pool question and universe independently', async () => {
		await expect(loadPortfolioSnapshot(fixture({ wrongPoolQuestion: true }).parameters)).rejects.toThrow('Canonical pool identity mismatch')
		await expect(loadPortfolioSnapshot(fixture({ wrongPoolUniverse: true }).parameters)).rejects.toThrow('Canonical pool identity mismatch')
	})

	test('rejects pending block anchors with no stable number or hash', async () => {
		const { parameters, client } = fixture()
		await expect(loadPortfolioSnapshot({ ...parameters, client: { ...client, getBlock: async () => ({ timestamp: 1000n }) } })).rejects.toThrow('requires a mined block')
	})

	test('rejects an anchor reorg or a vault belonging to another manager', async () => {
		await expect(loadPortfolioSnapshot(fixture({ reorg: true }).parameters)).rejects.toThrow('Chain changed')
		await expect(loadPortfolioSnapshot(fixture({ unrelatedOwner: true }).parameters)).rejects.toThrow('another portfolio')
	})

	test('marks truncated registry and queue scans incomplete instead of asserting all exposure is known', async () => {
		const snapshot = await loadPortfolioSnapshot({ ...fixture({ questionCount: 2n, operationCount: 2n }).parameters, maximumQuestions: 1, maximumOperations: 1 })
		expect(snapshot.coverage.complete).toBe(false)
		expect(snapshot.coverage.registryComplete).toBe(false)
		expect(snapshot.coverage.issues).toHaveLength(2)
		expect(snapshot.branches[0]?.positions[0]?.queuedOperationsComplete).toBe(false)
		expect(snapshot.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(false)
	})

	test('allows a complete selected-question read despite a large permissionless registry', async () => {
		const snapshot = await loadPortfolioSnapshot({ ...fixture({ questionCount: 100_000n }).parameters, questionIds: [51n] })
		expect(snapshot.coverage.complete).toBe(true)
		expect(snapshot.coverage.registryComplete).toBe(false)
		expect(snapshot.questions).toEqual([51n])
		await expect(loadPortfolioSnapshot({ ...fixture().parameters, questionIds: [52n] })).rejects.toThrow('not registered')
	})

	test('discovers automatically allocated positions outside the saved watchlist without scanning the registry', async () => {
		const { parameters, client } = fixture({ questionCount: 100_000n })
		const automaticPool: Address = '0x0000000000000000000000000000000000000010'
		const automaticOrigin: Hex = `0x${'22'.repeat(32)}`
		const pages: { args: readonly unknown[]; blockNumber: bigint }[] = []
		const readContract: PortfolioReadClient['readContract'] = async request => {
			if (request.functionName === 'getQuestions') throw new Error('The permissionless registry must not be scanned.')
			if (request.functionName === 'allocatedQuestionCount') return 1n
			if (request.functionName === 'getAllocatedQuestions') {
				expect(request.address).toBe(vault)
				pages.push({ args: request.args ?? [], blockNumber: request.blockNumber })
				return [52n]
			}
			if (request.functionName === 'questionOriginIds' && request.args?.[0] === 52n) return automaticOrigin
			if (request.functionName === 'getPortfolioOriginId' && request.args?.[2] === 52n) return automaticOrigin
			if (request.functionName === 'getSecurityPool' && request.args?.[0] === automaticOrigin) return request.args[1] === 0n ? automaticPool : zeroAddress
			if (request.functionName === 'questionId' && request.address === automaticPool) return 52n
			return await client.readContract(request)
		}
		const snapshot = await loadPortfolioSnapshot({ ...parameters, client: { ...client, readContract }, questionIds: [51n] })
		expect(snapshot.questions).toEqual([51n, 52n])
		expect(snapshot.branches[0]?.positions.map(position => position.questionId)).toEqual([51n, 52n])
		expect(snapshot.coverage.complete).toBe(true)
		expect(snapshot.coverage.registryComplete).toBe(false)
		expect(pages).toEqual([{ args: [0n, 1n], blockNumber: 123n }])
	})

	test('reads later allocated position pages without scanning earlier allocations or the registry', async () => {
		const { parameters, pages } = allocatedFixture()
		const snapshot = await loadPortfolioSnapshot({ ...parameters, questionIds: [], allocatedQuestionStart: 256n, maximumAllocatedQuestions: 65 })
		expect(snapshot.allocatedQuestionPage).toEqual({ start: 256n, count: 65n, total: 400n })
		expect(snapshot.questions).toEqual(Array.from({ length: 65 }, (_, index) => 307n + BigInt(index)))
		expect(snapshot.branches[0]?.positions).toHaveLength(65)
		expect(snapshot.branches[0]?.idleAttoRep).toBe(20n)
		expect(snapshot.coverage.complete).toBe(false)
		expect(snapshot.coverage.registryComplete).toBe(false)
		expect(snapshot.coverage.issues).toEqual([])
		expect(pages).toEqual([
			{ functionName: 'getAllocatedQuestions', args: [256n, 64n], blockNumber: 123n },
			{ functionName: 'getAllocatedQuestions', args: [320n, 1n], blockNumber: 123n },
		])
	})

	test('revalidates an explicit selection without appending unrelated allocated positions', async () => {
		const { parameters, pages } = allocatedFixture()
		const snapshot = await loadPortfolioSnapshot({ ...parameters, questionIds: [399n], maximumAllocatedQuestions: 0 })
		expect(snapshot.questions).toEqual([399n])
		expect(snapshot.allocatedQuestionPage).toEqual({ start: 0n, count: 0n, total: 400n })
		expect(snapshot.coverage.complete).toBe(false)
		expect(snapshot.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(true)
		expect(pages).toEqual([])
	})

	test('keeps idle branch balances available on empty position pages using only a fixed origin seed', async () => {
		const { parameters, pages } = allocatedFixture()
		const snapshot = await loadPortfolioSnapshot({ ...parameters, questionIds: [], allocatedQuestionStart: 448n, maximumAllocatedQuestions: 64 })
		expect(snapshot.questions).toEqual([])
		expect(snapshot.allocatedQuestionPage).toEqual({ start: 448n, count: 0n, total: 400n })
		expect(snapshot.branches.map(branch => [branch.idleAttoRep, branch.positions.length])).toEqual([
			[20n, 0],
			[90n, 0],
		])
		expect(snapshot.coverage.complete).toBe(false)
		expect(pages).toEqual([{ functionName: 'getQuestions', args: [0n, 1n], blockNumber: 123n }])
	})

	test('rejects incomplete allocated pages and authenticates the fixed seed for an empty page', async () => {
		const { parameters } = allocatedFixture()
		for (const page of [[], [1n << 256n]]) {
			const client: PortfolioReadClient = { ...parameters.client, readContract: request => (request.functionName === 'getAllocatedQuestions' ? Promise.resolve(page) : parameters.client.readContract(request)) }
			await expect(loadPortfolioSnapshot({ ...parameters, client, questionIds: [], allocatedQuestionStart: 256n, maximumAllocatedQuestions: 1 })).rejects.toThrow(page.length === 0 ? 'Incomplete allocated question page' : 'uint256')
		}
		await expect(loadPortfolioSnapshot({ ...fixture({ forgedOrigin: true }).parameters, questionIds: [], maximumAllocatedQuestions: 0 })).rejects.toThrow('Portfolio question origin mismatch')
	})

	test('an unrelated pool queue cannot prevent allocating to a completely scanned question', async () => {
		const { parameters, client } = fixture()
		const secondPool: Address = '0x0000000000000000000000000000000000000010'
		const secondCoordinator: Address = '0x0000000000000000000000000000000000000011'
		const secondOrigin: Hex = `0x${'22'.repeat(32)}`
		const readContract: PortfolioReadClient['readContract'] = async request => {
			const { address, functionName, args = [] } = request
			switch (functionName) {
				case 'questionCount':
					return 2n
				case 'getQuestions':
					return [51n, 52n]
				case 'questionOriginIds':
					return args[0] === 52n ? secondOrigin : hash
				case 'getPortfolioOriginId':
					return args[2] === 52n ? secondOrigin : hash
				case 'getSecurityPool':
					return args[0] === secondOrigin ? secondPool : pool
				case 'questionId':
					return address === secondPool ? 52n : 51n
				case 'openOraclePriceCoordinator':
					return address === secondPool ? secondCoordinator : coordinator
				case 'getForkTime':
					return 0n
				case 'securityVaults':
					return [0n, 0n, 0n, 0n]
				case 'getActiveStagedOperationCount':
					return address === secondCoordinator ? 0n : 300n
				case 'getActiveStagedOperations': {
					const start = args[0]
					const count = args[1]
					if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected a queue page.')
					const ids = Array.from({ length: Number(count) }, (_, index) => start + BigInt(index))
					return [ids, ids.map(() => ({ operation: 0n, operator: owner, receiverVault: owner, targetVault: owner, queuedAt: 900n, validForSeconds: 100n }))]
				}
				default:
					return client.readContract(request)
			}
		}
		const snapshot = await loadPortfolioSnapshot({ ...parameters, client: { ...client, readContract }, universeIds: [0n] })
		expect(snapshot.coverage.complete).toBe(false)
		expect(snapshot.coverage.issues).toHaveLength(1)
		expect(snapshot.branches[0]?.positions.every(position => position.queuedOperations.length === 0)).toBe(true)
		expect(snapshot.branches[0]?.positions.map(position => position.queuedOperationsComplete)).toEqual([false, true])
		const allocation = { questionId: 52n, depositAttoRep: 4n, commitmentAttoEth: 1n }
		const plan = { snapshot, universeId: 0n, minimumIdleAttoRep: 10n, minimumHealthFactorBps: 10_000n, allocations: [allocation] }
		expect(planPortfolioAllocations(plan).idleAfterAttoRep).toBe(16n)
		expect(() => planPortfolioAllocations({ ...plan, allocations: [{ ...allocation, questionId: 51n }] })).toThrow('operation scan is incomplete')
	})

	test('fails closed on malformed pages and invalid request bounds', async () => {
		await expect(loadPortfolioSnapshot(fixture({ omitPage: true }).parameters)).rejects.toThrow('Incomplete question page')
		await expect(loadPortfolioSnapshot({ ...fixture().parameters, maximumOperations: 0 })).rejects.toThrow('Operation scan limit')
		await expect(loadPortfolioSnapshot({ ...fixture().parameters, universeIds: [-1n] })).rejects.toThrow('uint248')
		await expect(loadPortfolioSnapshot({ ...fixture().parameters, allocatedQuestionStart: -1n })).rejects.toThrow('uint256')
		await expect(loadPortfolioSnapshot({ ...fixture().parameters, allocatedQuestionStart: 1n << 256n })).rejects.toThrow('uint256')
		await expect(loadPortfolioSnapshot({ ...fixture().parameters, maximumAllocatedQuestions: -1 })).rejects.toThrow('Allocated question scan limit')
		await expect(loadPortfolioSnapshot({ ...fixture().parameters, maximumAllocatedQuestions: 4097 })).rejects.toThrow('Allocated question scan limit')
	})

	test('indexed vault history bypasses unrelated spam in the selected pool queue', async () => {
		const { parameters, logReads } = filteredFixture()
		const snapshot = await loadPortfolioSnapshot(parameters)
		const plan = planPortfolioAllocations({ snapshot, universeId: 0n, minimumIdleAttoRep: 10n, minimumHealthFactorBps: 10_000n, allocations: [{ questionId: 51n, depositAttoRep: 4n, commitmentAttoEth: 1n }] })
		expect(plan.idleAfterAttoRep).toBe(16n)
		expect(snapshot.coverage.complete).toBe(false)
		expect(snapshot.branches[0]?.positions[0]?.queuedOperationsComplete).toBe(false)
		expect(snapshot.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(true)
		expect(logReads.map(request => request.args)).toEqual([{ operator: vault }, { receiverVault: vault }])
		expect(logReads.every(request => request.address === coordinator && request.fromBlock === 0n && request.toBlock === 123n)).toBe(true)
	})

	test('filtered history confirms live operations in each vault role at the snapshot block', async () => {
		for (const role of ['operator', 'receiverVault', 'targetVault'] as const) {
			const { parameters, reads } = filteredFixture({ role })
			const snapshot = await loadPortfolioSnapshot(parameters)
			expect(snapshot.coverage.complete).toBe(false)
			expect(snapshot.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(true)
			expect(snapshot.branches[0]?.positions[0]?.queuedOperations.map(operation => operation.operationId)).toEqual([8n])
			expect(reads.filter(read => read.functionName === 'stagedOperations')).toEqual(role === 'targetVault' ? [] : [{ functionName: 'stagedOperations', blockNumber: 123n }])
			const plan = () => planPortfolioAllocations({ snapshot, universeId: 0n, minimumIdleAttoRep: 10n, minimumHealthFactorBps: 10_000n, allocations: [{ questionId: 51n, depositAttoRep: 4n, commitmentAttoEth: 1n }] })
			if (role === 'targetVault') expect(plan().idleAfterAttoRep).toBe(16n)
			else expect(plan).toThrow('pending operations')
		}
		const consumed = await loadPortfolioSnapshot(filteredFixture({ role: 'operator', consumed: true }).parameters)
		expect(consumed.branches[0]?.positions[0]?.queuedOperations).toEqual([])
		expect(consumed.coverage.complete).toBe(false)
		expect(consumed.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(true)
	})

	test('unavailable, malformed, foreign or mismatched history cannot authorize a selected question', async () => {
		for (const failure of [{ failLogs: true }, { malformedLog: true }, { foreignLog: true }, { foreignOperation: true }, { zeroId: true }]) {
			const snapshot = await loadPortfolioSnapshot(filteredFixture({ role: 'operator', ...failure }).parameters)
			expect(snapshot.coverage.complete).toBe(false)
			expect(snapshot.branches[0]?.positions[0]?.queuedOperationsComplete).toBe(false)
			expect(snapshot.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(false)
			expect(() => planPortfolioAllocations({ snapshot, universeId: 0n, minimumIdleAttoRep: 10n, minimumHealthFactorBps: 10_000n, allocations: [{ questionId: 51n, depositAttoRep: 4n, commitmentAttoEth: 1n }] })).toThrow('operation scan is incomplete')
		}
		await expect(loadPortfolioSnapshot(filteredFixture({ reorg: true }).parameters)).rejects.toThrow('Chain changed')
	})

	test('provider range limits split filtered history without skipping blocks', async () => {
		const { parameters, logReads } = filteredFixture()
		const getLogs = parameters.client.getLogs
		if (getLogs === undefined) throw new Error('Expected the history fixture.')
		const snapshot = await loadPortfolioSnapshot({
			...parameters,
			client: {
				...parameters.client,
				getLogs: async request => {
					if (request.toBlock - request.fromBlock >= 32n) throw new Error('Block range exceeds the provider limit.')
					return getLogs(request)
				},
			},
		})
		expect(snapshot.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(true)
		for (const role of ['operator', 'receiverVault']) {
			const ranges = logReads.filter(request => request.args[role] === vault)
			let nextBlock = 0n
			for (const range of ranges) {
				expect(range.fromBlock).toBe(nextBlock)
				nextBlock = range.toBlock + 1n
			}
			expect(nextBlock).toBe(124n)
		}
	})

	test('duplicate history records hydrate each live operation once', async () => {
		const { parameters, reads } = filteredFixture({ role: 'operator' })
		const getLogs = parameters.client.getLogs
		if (getLogs === undefined) throw new Error('Expected the history fixture.')
		const snapshot = await loadPortfolioSnapshot({ ...parameters, client: { ...parameters.client, getLogs: async request => (await getLogs(request)).flatMap(log => [log, log]) } })
		expect(snapshot.branches[0]?.positions[0]?.queuedOperations).toHaveLength(1)
		expect(reads.filter(read => read.functionName === 'stagedOperations')).toHaveLength(1)
	})

	test('old approved-receiver spam never requires hydrating expired history', async () => {
		const { parameters, reads, logReads } = filteredFixture({ role: 'receiverVault', consumed: true })
		const snapshot = await loadPortfolioSnapshot({
			...parameters,
			client: {
				...parameters.client,
				getBlock: async request => ({ number: request?.blockNumber ?? 123n, timestamp: (request?.blockNumber ?? 123n) * 10n, hash }),
				getLogs: async request => {
					logReads.push(request)
					if (request.args['receiverVault'] !== vault || request.fromBlock > 1n) return []
					return Array.from({ length: 300 }, (_, index) => operationLog(request, { operator: owner, receiverVault: vault, targetVault: owner }, 10_000n + BigInt(index)))
				},
			},
		})
		expect(reads.filter(read => read.functionName === 'stagedOperations')).toHaveLength(0)
		expect(snapshot.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(true)
		expect(logReads.find(request => request.args['receiverVault'] === vault)?.fromBlock).toBe(87n)
		expect(logReads.find(request => request.args['operator'] === vault)?.fromBlock).toBe(0n)
	})

	test('receiver history includes the exact maximum expiry boundary and excludes it one second later', async () => {
		for (const timestamp of [1230n, 1231n]) {
			const { parameters, logReads } = filteredFixture({ role: 'receiverVault' })
			const snapshot = await loadPortfolioSnapshot({
				...parameters,
				client: {
					...parameters.client,
					getBlock: async request => {
						const number = request?.blockNumber ?? 123n
						return { number, timestamp: number === 123n ? timestamp : number * 10n, hash }
					},
					getLogs: async request => {
						logReads.push(request)
						if (request.args['receiverVault'] !== vault || request.fromBlock > 87n) return []
						return [operationLog(request, { operator: owner, receiverVault: vault, targetVault: owner })]
					},
					readContract: async request => {
						if (request.functionName === 'stagedOperations') return [0n, owner, vault, owner, 1n, 870n, 300n, 0n, 0n, zeroHash, 0n]
						return parameters.client.readContract(request)
					},
				},
			})
			expect(snapshot.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(true)
			expect(logReads.find(request => request.args['receiverVault'] === vault)?.fromBlock).toBe(timestamp === 1230n ? 87n : 88n)
			const plan = () => planPortfolioAllocations({ snapshot, universeId: 0n, minimumIdleAttoRep: 10n, minimumHealthFactorBps: 10_000n, allocations: [{ questionId: 51n, depositAttoRep: 4n, commitmentAttoEth: 1n }] })
			if (timestamp === 1230n) expect(plan).toThrow('pending operations')
			else expect(plan().idleAfterAttoRep).toBe(16n)
		}
	})

	test('receiver history clamps to genesis and fails closed when historical timestamps cannot be verified', async () => {
		const { parameters, logReads } = filteredFixture()
		const nearGenesis = await loadPortfolioSnapshot({ ...parameters, client: { ...parameters.client, getBlock: async request => ({ number: request?.blockNumber ?? 123n, timestamp: 100n, hash }) } })
		expect(nearGenesis.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(true)
		expect(logReads.find(request => request.args['receiverVault'] === vault)?.fromBlock).toBe(0n)
		for (const failure of ['missing', 'wrong-number', 'future-timestamp']) {
			const snapshot = await loadPortfolioSnapshot({
				...parameters,
				client: {
					...parameters.client,
					getBlock: async request => {
						if (request?.blockNumber === undefined || request.blockNumber === 123n) return { number: 123n, timestamp: 1230n, hash }
						if (failure === 'missing') throw new Error('Historical block unavailable.')
						if (failure === 'wrong-number') return { number: 123n, timestamp: request.blockNumber * 10n, hash }
						return { number: request.blockNumber, timestamp: 1231n, hash }
					},
				},
			})
			expect(snapshot.branches[0]?.positions[0]?.allocationOperationsComplete).toBe(false)
			expect(() => planPortfolioAllocations({ snapshot, universeId: 0n, minimumIdleAttoRep: 10n, minimumHealthFactorBps: 10_000n, allocations: [{ questionId: 51n, depositAttoRep: 4n, commitmentAttoEth: 1n }] })).toThrow('operation scan is incomplete')
		}
	})
})

for (const state of [
	{ resolved: true, forkContinuation: false, totalDisputeStakedAttoRep: 5n, pending: true },
	{ resolved: true, forkContinuation: false, totalDisputeStakedAttoRep: 0n, pending: false },
	{ resolved: true, forkContinuation: true, totalDisputeStakedAttoRep: 5n, pending: false },
	{ resolved: false, forkContinuation: false, totalDisputeStakedAttoRep: 5n, pending: true },
]) {
	test(`ordinary residual snapshot: final ${state.resolved}, continuation ${state.forkContinuation}, escrow ${state.totalDisputeStakedAttoRep}`, async () => {
		const { client, reads } = fixture({ ...state, game: coordinator })
		const snapshot = await loadPortfolioSnapshot({ client, portfolio, vault, universeIds: [0n] })
		expect(snapshot.branches[0]?.positions[0]?.ordinaryResidualPending).toBe(state.pending)
		expect(reads.every(read => read.blockNumber === snapshot.blockNumber)).toBe(true)
	})
}

test('malformed residual metadata rejects the snapshot instead of allowing an unsafe exit', async () => {
	const { client } = fixture({ resolved: true, game: coordinator, forkContinuation: 'false' })
	await expect(loadPortfolioSnapshot({ client, portfolio, vault, universeIds: [0n] })).rejects.toThrow('Invalid boolean')
})

test('reports the pool feed identity and another question’s pending report coordinator at one block', async () => {
	const { client, parameters } = fixture()
	const sharedFeed = getAddress('0x0000000000000000000000000000000000000011')
	const requestingCoordinator = getAddress('0x0000000000000000000000000000000000000012')
	const readContract: PortfolioReadClient['readContract'] = async request => {
		expect(request.blockNumber).toBe(123n)
		if (request.functionName === 'priceFeed') return sharedFeed
		if (request.functionName === 'pendingReportId') return 42n
		if (request.functionName === 'pendingCoordinator') {
			expect(request.address).toBe(sharedFeed)
			return requestingCoordinator
		}
		return client.readContract(request)
	}
	const snapshot = await loadPortfolioSnapshot({ ...parameters, client: { ...client, readContract } })
	expect(snapshot.branches[0]?.positions[0]).toMatchObject({ coordinator, priceFeed: sharedFeed, pendingReportId: 42n, pendingReportCoordinator: requestingCoordinator })
})
