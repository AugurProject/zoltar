import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createPublicClient, http, getAddress, zeroHash, zeroAddress, decodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createMockReadClient, createBlockWithTimestamp } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { usePortfolioForkClaim, type PortfolioForkClaimParameters } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioForkClaim.js'
import { loadPortfolioForkClaimState } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolioFork.js'
import type { PortfolioAggregateSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'

const owner = getAddress('0x0000000000000000000000000000000000000011')
const portfolio = getAddress('0x0000000000000000000000000000000000000022')
const parent = getAddress('0x0000000000000000000000000000000000000033')
const child = getAddress('0x0000000000000000000000000000000000000044')
const vault = getAddress('0x0000000000000000000000000000000000000055')
const game = getAddress('0x0000000000000000000000000000000000000066')
const selection = { owner, portfolio, questionId: 51n, originUniverseId: 0n, positionId: 1n, intervalId: 0n, outcomeIndex: 1n }
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })

function fixture() {
	const state = { timestamp: 1000n, systemState: 1, units: 0n, commitment: 0n, debt: 0n, escrow: 0n, ownerShares: 10n, intervalActive: true, sharedChoice: false, feed: true, dependencies: true, child: true, history: true }
	const reads: { functionName: string; blockNumber: bigint | undefined }[] = []
	const client = createPublicClient({ transport: http('https://example.test') }).extend(() => ({
		getBlock: async () => ({ ...createBlockWithTimestamp(state.timestamp), number: 9n, hash: zeroHash }),
		...createMockReadClient(async request => {
			reads.push({ functionName: request.functionName, blockNumber: request.blockNumber })
			switch (request.functionName) {
				case 'getPool':
					return parent
				case 'vaultOf':
					return vault
				case 'forkController':
					return game
				case 'isIntervalSelected':
					return state.sharedChoice
				case 'recoveryLedger':
					return game
				case 'getOwnerPositionShares':
					return state.ownerShares
				case 'systemState':
					return state.systemState
				case 'securityPoolFactory':
				case 'securityPoolForker':
				case 'zoltar':
					return portfolio
				case 'escalationGame':
					return game
				case 'getOwnerInterval':
					return { generation: 1n, startPosition: 1n, endPosition: 0n, shares: 10n, repIndex: 0n, feeIndex: 0n, open: true, active: state.intervalActive }
				case 'securityVaults':
					return [state.units, state.commitment, 0n, 0n]
				case 'vaultBadDebtAttoEth':
					return state.debt
				case 'disputeStakedRepByVaultAttoRep':
					return state.escrow
				case 'forkData':
					return [0n, parent, 0n, 0n, 0n, 0n, 0n, 0n, false, false, 1n, 100n]
				case 'getChildUniverseId':
					return 7n
				case 'universes':
					return [100n, 51n, parent]
				case 'zoltarQuestionData':
					return game
				case 'questions':
					return ['Will the example settle Yes?', 0n, 500n, 0n, 0n, 0n, 0n, '']
				case 'getOutcomeLabels':
					if (request.args?.[1] === 0n) return ['Yes']
					if (request.args?.[1] === 1n) return ['No']
					return []
				case 'getSecurityPoolOriginId':
					return zeroHash
				case 'sharedPriceFeeds':
					return state.feed ? parent : zeroAddress
				case 'getChildPoolDependencies':
					return state.dependencies ? [parent, parent] : [zeroAddress, zeroAddress]
				case 'getSecurityPool':
					return state.child ? child : zeroAddress
				case 'isForkCarryFundingComplete':
					return state.history
				default:
					throw new Error(`Unexpected fork read ${request.functionName}`)
			}
		}),
	}))
	return { state, client, reads }
}

test('fork readiness reads one allocation and its chosen child at a single block', async () => {
	const { client, reads } = fixture()
	expect(await loadPortfolioForkClaimState(client, selection)).toEqual({ parent, reason: undefined, questionTitle: 'Will the example settle Yes?', outcomeLabel: 'Yes' })
	expect(reads.length).toBeLessThan(36)
	expect(reads.every(read => read.blockNumber === 9n)).toBe(true)
	expect(reads.some(read => read.functionName === 'getQuestions' || read.functionName === 'getVaults')).toBe(false)
})

for (const scenario of [
	{ patch: { systemState: 0 }, reason: 'Activate this question' },
	{ patch: { ownerShares: 0n }, reason: 'No' },
	{ patch: { intervalActive: false }, reason: 'ownership history changed' },
	{ patch: { sharedChoice: true }, reason: 'saved shared branch' },
	{ patch: { units: 1n }, reason: 'existing individual question position' },
	{ patch: { debt: 1n }, reason: 'existing individual question position' },
	{ patch: { escrow: 1n }, reason: 'existing dispute position' },
	{ patch: { timestamp: 5_000_000n }, reason: 'closed' },
	{ patch: { feed: false }, reason: 'price feed' },
	{ patch: { dependencies: false }, reason: 'pool contracts' },
	{ patch: { child: false }, reason: 'Create the selected child' },
	{ patch: { history: false }, reason: 'dispute history' },
])
	test(`fork claim blocks ${Object.keys(scenario.patch).join(', ')}`, async () => {
		const { client, state } = fixture()
		Object.assign(state, scenario.patch)
		expect((await loadPortfolioForkClaimState(client, selection)).reason?.toLowerCase()).toContain(scenario.reason.toLowerCase())
	})

const allocation = { positionId: 1n, questionId: 51n, custody: parent, ownerShares: 10n, remainingShares: 10n, reusable: false, recoveryComplete: false, recoveryBountyAttoEth: 0n, questionEndTime: 500n, operational: false, resolved: false, claimReason: undefined }
const snapshot: PortfolioAggregateSnapshot = {
	portfolio,
	owner,
	chainId: 1,
	blockNumber: 9n,
	blockHash: zeroHash,
	timestamp: 1000n,
	originUniverseId: 0n,
	forkTime: 100n,
	repToken: parent,
	shares: 10n,
	totalShares: 10n,
	assetsAttoRep: 10n,
	ownerAssetsAttoRep: 10n,
	claimableFeesAttoEth: 0n,
	recoveryLedger: game,
	intervalCount: 1n,
	intervalStart: 0n,
	intervals: [{ intervalId: 0n, generation: 1n, startPosition: 1n, endPosition: 0n, shares: 10n, open: true, active: true }],
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
	positionCount: 1n,
	positionStart: 0n,
	positions: [allocation],
}

test('fork choice requires explicit input, builds only one transaction and revalidates newly acquired native holdings', async () => {
	const { client, state } = fixture()
	installActiveEnvironmentForTesting({ ...createFakeBackend({ accountAddress: owner }), createReadClient: () => client })
	const requests: PortfolioTransaction[] = []
	const parameters: PortfolioForkClaimParameters = {
		snapshot,
		allocation,
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
	const hook = lifecycle.trackRendered(await renderHookWithProps(() => usePortfolioForkClaim(parameters), {}))
	expect(hook.state().reason).toContain('Enter a valid fork outcome')
	await act(() => {
		hook.state().setOutcome('1')
	})
	await waitFor(() => expect(hook.state().reason).toBeUndefined())
	expect(hook.state().needsPreparation).toBe(false)
	await act(async () => {
		await hook.state().claim()
	})
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Missing fork request')
	expect(decodeFunctionData({ abi: parseAbi(['function claimPositionAndMigrate(uint256,uint256,uint256)']), data: request.data })).toEqual({ functionName: 'claimPositionAndMigrate', args: [1n, 0n, 1n] })
	await request.validateBeforeSubmit?.()
	state.units = 1n
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('existing individual question position')
	state.units = 0n
	state.feed = false
	await act(() => hook.state().refresh())
	await waitFor(() => expect(hook.state().reason).toContain('price feed'))
	expect(hook.state().needsPreparation).toBe(true)
})
