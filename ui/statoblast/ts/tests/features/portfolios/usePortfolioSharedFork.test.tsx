import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createPublicClient, http, getAddress, zeroHash, zeroAddress, decodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createMockReadClient, createBlockWithTimestamp } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { usePortfolioSharedFork, type PortfolioSharedForkParameters } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioSharedFork.js'
import type { PortfolioAggregateSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'

const owner = getAddress('0x0000000000000000000000000000000000000011')
const portfolio = getAddress('0x0000000000000000000000000000000000000022')
const controller = getAddress('0x0000000000000000000000000000000000000033')
const parent = getAddress('0x0000000000000000000000000000000000000044')
const child = getAddress('0x0000000000000000000000000000000000000055')
const ledger = getAddress('0x0000000000000000000000000000000000000066')
const token = getAddress('0x0000000000000000000000000000000000000077')
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const snapshot: PortfolioAggregateSnapshot = {
	portfolio,
	owner,
	chainId: 1,
	blockNumber: 9n,
	blockHash: zeroHash,
	timestamp: 1000n,
	originUniverseId: 0n,
	forkTime: 100n,
	repToken: token,
	shares: 1n,
	totalShares: 1n,
	assetsAttoRep: 0n,
	ownerAssetsAttoRep: 0n,
	claimableFeesAttoEth: 0n,
	recoveryLedger: ledger,
	intervalCount: 1n,
	intervalStart: 0n,
	intervals: [{ intervalId: 0n, generation: 1n, startPosition: 1n, endPosition: 2n, shares: 1n, open: false, active: true }],
	recoverableRepAttoRep: 0n,
	recoverableFeesAttoEth: 0n,
	processingRewardsAttoEth: 0n,
	walletAttoRep: 0n,
	allowanceAttoRep: 0n,
	reserveAttoRep: 0n,
	reserveCapacityAttoEth: 0n,
	questionCount: 1n,
	questionStart: 0n,
	questions: [51n],
	positionCount: 2n,
	positionStart: 0n,
	positions: [],
}

async function fixture() {
	const state = {
		timestamp: 1000n,
		cutoff: 2000n,
		selected: false,
		branchProcessed: false,
		branchWeight: 1n,
		feed: true,
		parentMaterialized: true,
		childMaterialized: false,
		childPoolExists: true,
		childSystemState: 2,
		recoveredRep: 0n,
		remainingShares: 1n,
		recoveryComplete: false,
		selectedContext: 0n,
		childContextId: 1n,
		beforeRead: (): Promise<void> => Promise.resolve(),
	}
	const requests: PortfolioTransaction[] = []
	const reads: { name: string; blockNumber: bigint | undefined }[] = []
	const client = createPublicClient({ transport: http('https://example.test') }).extend(() => ({
		getChainId: async () => 1,
		getBlock: async () => {
			await state.beforeRead()
			return { ...createBlockWithTimestamp(state.timestamp), number: 9n, hash: zeroHash }
		},
		...createMockReadClient(async request => {
			reads.push({ name: request.functionName, blockNumber: request.blockNumber })
			switch (request.functionName) {
				case 'vaultOf':
					return zeroAddress
				case 'forkController':
					return controller
				case 'contextCount':
					return 2n
				case 'getContext':
					return { universeId: request.args?.[0] === 0n ? 0n : 7n, parentContextId: 0n, outcomeIndex: 37n, incomingActivationFloor: 0n, ledger, repToken: token, pointCount: 2n }
				case 'choiceWindow':
					return request.args?.[0] === 0n ? [100n, state.cutoff] : [0n, 0n]
				case 'getOwnerIntervalCount':
					return 1n
				case 'getOwnerInterval':
					return { generation: 1n, startPosition: 1n, endPosition: 2n, shares: 1n, repIndex: 0n, feeIndex: 0n, open: false, active: true }
				case 'choices':
					return [request.args?.[0] === 0n && state.selected, 37n, 0n]
				case 'previewClaim':
					return [state.recoveredRep, 0n]
				case 'childContextIds':
					return state.childContextId
				case 'readPosition':
					return { custody: (request.args?.[0] === 0n ? state.parentMaterialized : state.childMaterialized) ? parent : zeroAddress, remainingShares: request.args?.[0] !== 0n && !state.childMaterialized ? 0n : state.remainingShares, unmigratedShares: 1n, recoveryComplete: state.recoveryComplete }
				case 'positions':
					return [51n, 1n, 1n, parent]
				case 'processedPositions':
					return state.branchProcessed
				case 'getBranchWeight':
					return state.branchWeight
				case 'getPool':
					if (request.args?.[1] !== 0n && !state.childPoolExists) throw new Error('Question pool unavailable')
					return request.args?.[1] === 0n ? parent : child
				case 'factory':
					return controller
				case 'questionOriginIds':
					return '0x0000000000000000000000000000000000000000000000000000000000000099'
				case 'systemState':
					return request.address === parent ? 1 : state.childSystemState
				case 'isEscalationResolved':
					return false
				case 'securityPoolFactory':
				case 'securityPoolForker':
					return controller
				case 'forkData':
					return [0n, parent, 0n, 0n, 0n, 0n, 0n, 0n, false, false, 1n, 100n]
				case 'getChildUniverseId':
					return 7n
				case 'getSecurityPoolOriginId':
					return zeroHash
				case 'sharedPriceFeeds':
					return state.feed ? parent : zeroAddress
				case 'getChildPoolDependencies':
					return [parent, parent]
				case 'getSecurityPool':
					if (request.args?.[1] === 0n) return parent
					return state.childPoolExists ? child : zeroAddress
				case 'escalationGame':
					return parent
				case 'isForkCarryFundingComplete':
					return true
				case 'universes':
					return [100n, 51n, parent]
				case 'zoltarQuestionData':
					return parent
				case 'questions':
					return ['Which branch is valid?', 0n, 500n, 0n, 0n, 0n, 0n, '']
				case 'getOutcomeLabels':
					return request.args?.[1] === 36n ? ['Branch 37'] : ['First branch']
				default:
					throw new Error(`Unexpected shared fork read ${request.functionName}`)
			}
		}),
	}))
	installActiveEnvironmentForTesting({ ...createFakeBackend({ accountAddress: owner }), createReadClient: () => client })
	const parameters: PortfolioSharedForkParameters = {
		snapshot,
		actions: {
			scope: unscopedTransaction,
			busy: undefined,
			ownerReason: undefined,
			runPortfolioAction: async (_action, _label, build) => {
				requests.push(await build())
			},
		},
		onConfirmed: async () => undefined,
	}
	const hook = lifecycle.trackRendered(await renderHookWithProps(() => usePortfolioSharedFork(parameters), {}))
	await waitFor(() => expect(hook.state().state).toBeDefined())
	return { hook, state, requests, reads }
}

test('shared enrollment chooses explicitly once per ownership page and revalidates the cutoff before submission', async () => {
	const { hook, state, requests, reads } = await fixture()
	expect(hook.state().chooseReason).toContain('valid fork outcome')
	await act(() => hook.state().setOutcome('37'))
	await waitFor(() => expect(hook.state().chooseReason).toBeUndefined())
	expect(hook.state().selectedBranch).toContain('Branch 37')
	await act(async () => await hook.state().choose())
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Missing choice request')
	expect(decodeFunctionData({ abi: parseAbi(['function chooseSharedFork(uint256,uint256[],uint256)']), data: request.data }).args).toEqual([0n, [0n], 37n])
	state.timestamp = state.cutoff
	await request.validateBeforeSubmit?.()
	state.timestamp += 1n
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('window has closed')
	expect(reads.every(read => read.blockNumber === 9n)).toBe(true)
})

test('saved branch navigation and revocation are bounded to the owner page and preserve explicit submission', async () => {
	const { hook, state, requests } = await fixture()
	state.selected = true
	await act(() => hook.state().refresh())
	await waitFor(() => expect(hook.state().selectedCount).toBe(1))
	expect(hook.state().branches).toEqual([{ contextId: 1n, label: 'Branch 37' }])
	await act(async () => await hook.state().revoke())
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Missing revoke request')
	expect(decodeFunctionData({ abi: parseAbi(['function revokeSharedFork(uint256,uint256[])']), data: request.data }).args).toEqual([0n, [0n]])
	state.selected = false
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('changed')
	await act(() => hook.state().openContext(1n))
	await waitFor(() => expect(hook.state().state?.contextId).toBe(1n))
	expect(hook.state().incomingLabel).toContain('Branch 37')
	expect(requests).toHaveLength(1)
})

test('one processing click migrates one shared allocation and rechecks native prerequisites and completion', async () => {
	const { hook, state, requests } = await fixture()
	state.timestamp = 3000n
	await act(() => {
		hook.state().setOutcome('37')
		hook.state().setPosition('2')
	})
	await waitFor(() => expect(hook.state().processReason).toBeUndefined())
	expect(hook.state().preparation?.needsPreparation).toBe(false)
	await act(async () => await hook.state().process())
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Missing processing request')
	expect(decodeFunctionData({ abi: parseAbi(['function processForkPosition(uint256,uint256,uint256)']), data: request.data }).args).toEqual([0n, 2n, 37n])
	state.feed = false
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('price feed')
	state.feed = true
	state.branchProcessed = true
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('changed')
})

test('child collection permits zero-payout incoming migration while individual fallback waits for materialized ownership', async () => {
	const { hook, state, requests } = await fixture()
	state.timestamp = 3000n
	await act(() => hook.state().openContext(1n))
	await waitFor(() => expect(hook.state().state?.contextId).toBe(1n))
	expect(hook.state().collectReason).toContain('No credited proceeds')
	await act(() => hook.state().setPosition('2'))
	await waitFor(() => expect(hook.state().collectReason).toBeUndefined())
	expect(hook.state().individualReason).toContain('parent fork context')
	await act(async () => await hook.state().collect())
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Missing collection request')
	expect(decodeFunctionData({ abi: parseAbi(['function claimForkRecovered(uint256,uint256[],uint256[])']), data: request.data }).args).toEqual([1n, [0n], [2n]])
	expect(request.reviewDescription).toContain('remain locked by the native pool lifecycle')
})

test('completed child backing cannot be extracted again and submission rechecks completion', async () => {
	const { hook, state, requests } = await fixture()
	state.childMaterialized = true
	state.childSystemState = 0
	await act(() => hook.state().openContext(1n))
	await waitFor(() => expect(hook.state().state?.contextId).toBe(1n))
	await act(() => hook.state().setPosition('2'))
	await waitFor(() => expect(hook.state().individualReason).toBeUndefined())
	await act(async () => await hook.state().individual(false))
	const request = requests[0]
	if (request === undefined) throw new Error('Missing individual request')
	state.remainingShares = 0n
	state.recoveryComplete = true
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('no remaining individual backing')
	await act(() => hook.state().refresh())
	await waitFor(() => expect(hook.state().individualReason).toContain('no remaining individual backing'))
})

test('completed child collection distinguishes finished allocation from empty input and still permits credited proceeds', async () => {
	const { hook, state } = await fixture()
	state.childMaterialized = true
	state.childSystemState = 0
	state.recoveryComplete = true
	await act(() => hook.state().openContext(1n))
	await waitFor(() => expect(hook.state().state?.contextId).toBe(1n))
	expect(hook.state().collectReason).toBe('No credited proceeds; enter an allocation ID to process recovery')
	await act(() => hook.state().setPosition('2'))
	await waitFor(() => expect(hook.state().position?.recoveryComplete).toBe(true))
	expect(hook.state().collectReason).toBe('This allocation’s recovery is complete with no unclaimed proceeds; choose another allocation')
	state.recoveredRep = 1n
	await act(() => hook.state().refresh())
	await waitFor(() => expect(hook.state().collectReason).toBeUndefined())
})

test('saved branch navigation distinguishes missing outcome, loading and absent branch before and after cutoff', async () => {
	const { hook, state, requests } = await fixture()
	state.selected = true
	await act(() => hook.state().refresh())
	await waitFor(() => expect(hook.state().selectedCount).toBe(1))
	expect(hook.state().openChildReason).toBe('Enter a valid fork outcome index')
	state.timestamp = state.cutoff + 1n
	await act(() => hook.state().refresh())
	await waitFor(() => expect(hook.state().chooseReason).toContain('window has closed'))
	expect(hook.state().openChildReason).toBe('Enter a valid fork outcome index')
	let release: (() => void) | undefined
	const pendingRead = new Promise<void>(resolve => {
		release = resolve
	})
	state.beforeRead = () => pendingRead
	await act(() => hook.state().setOutcome('37'))
	expect(hook.state().openChildReason).toBe('Loading shared fork choices')
	if (release === undefined) throw new Error('Missing pending read release')
	await act(() => release?.())
	await waitFor(() => expect(hook.state().openChildReason).toBeUndefined())
	state.childContextId = 0n
	await act(() => hook.state().refresh())
	await waitFor(() => expect(hook.state().state?.childContextId).toBe(0n))
	expect(hook.state().openChildReason).toBe('Save a branch choice to create its recovery context')
	state.childContextId = 1n
	await act(() => hook.state().refresh())
	await waitFor(() => expect(hook.state().openChildReason).toBeUndefined())
	await act(() => hook.state().openChild())
	await waitFor(() => expect(hook.state().state?.contextId).toBe(1n))
	expect(requests).toHaveLength(0)
})

test('enrolled child without pool or custody retains its snapshot, parent preparation and parent navigation', async () => {
	const { hook, state } = await fixture()
	state.selected = true
	state.childPoolExists = false
	state.feed = false
	await act(() => hook.state().openContext(1n))
	await waitFor(() => expect(hook.state().state?.contextId).toBe(1n))
	await act(() => hook.state().setPosition('2'))
	await waitFor(() => expect(hook.state().loading).toBe(false))
	expect(hook.state().error).toBeUndefined()
	expect(hook.state().state).toMatchObject({ contextId: 1n, parentContextId: 0n })
	expect(hook.state().position).toMatchObject({ pool: zeroAddress, custody: zeroAddress, recoveryComplete: false })
	expect(hook.state().preparation).toMatchObject({ pool: parent, needsPreparation: true })
	expect(hook.state().collectReason).toContain('after the choice cutoff')
	state.timestamp = state.cutoff + 1n
	await act(() => hook.state().refresh())
	await waitFor(() => expect(hook.state().collectReason).toContain('price feed'))
	expect(hook.state().preparation?.pool).toBe(parent)
	expect(hook.state().individualReason).toContain('parent fork context')
	const parentContextId = hook.state().state?.parentContextId
	if (parentContextId === undefined) throw new Error('Missing retained parent navigation')
	await act(() => hook.state().openContext(parentContextId))
	await waitFor(() => expect(hook.state().state?.contextId).toBe(0n))
})

test('completed child hole has no fictitious pool or preparation requirement', async () => {
	const { hook, state } = await fixture()
	state.childPoolExists = false
	state.recoveryComplete = true
	await act(() => hook.state().openContext(1n))
	await waitFor(() => expect(hook.state().state?.contextId).toBe(1n))
	await act(() => hook.state().setPosition('2'))
	await waitFor(() => expect(hook.state().loading).toBe(false))
	expect(hook.state().error).toBeUndefined()
	expect(hook.state().state?.contextId).toBe(1n)
	expect(hook.state().preparation).toMatchObject({ pool: zeroAddress, custody: zeroAddress, recoveryComplete: true, needsPreparation: false })
	expect(hook.state().collectReason).toContain('recovery is complete')
	expect(hook.state().individualReason).toBe('This allocation has no remaining individual backing')
})
