import { describe, expect, test } from 'bun:test'
import example from '../../config/operator.example.json'
import { address, hash, snapshotFixture } from '../operations/fixture.ts'
import { buildRetirementLiquidityRemovalPlan } from '../../src/operations/retirement-liquidity.ts'
import {
	applyRetirementAssessment,
	assessRetirement,
	buildAllowanceRevocationPlan,
	buildAssetSweepPlan,
	buildNativeOpenOracleCreditPlan,
	buildV3RetirementPlan,
	operationAllowedDuringRetirement,
	readV3PositionsWithQuorum,
	reconcileV3PositionJournal,
	retirementPlanFromEvaluations,
	type V3PositionAnchor,
	type V3PositionObservation,
} from '../../src/runtime/retirement.ts'
import { initialDurableState, initialRuntimeState, type DurableWorkflow } from '../../src/state/operator-state.ts'
import { acceptResidualProfileReplacement, cancelRetirement, DEFAULT_RETIREMENT_POLICIES, initialRetirementState, registerV3Position, requestRetirement, uniswapV3PositionKey, type DurableV3Position } from '../../src/state/retirement.ts'
import type { EvaluatedOperation, OperationPlan } from '../../src/operations/types.ts'
import { parseSettings } from '../../src/config/settings.ts'
import { processRetirementCycle, recordV3ScanFailure, recordV3ScanSuccess, updateV3PositionStatus } from '../../src/runtime/retirement-runner.ts'
import { assertOperationEthFunding } from '../../src/execution/safety.ts'
import { recordCanonicalRecoveredBalances } from '../../src/runtime/retirement-balance-evidence.ts'
import { CHAOS_OPERATION_CATALOG } from '../../src/operations/catalog.ts'
import { unclassifiedRetirementOperations } from '../../src/runtime/retirement-operation-policy.ts'
import { resetPristineStateForDeploymentProfile, verifyRetirementCompletionFinality } from '../../src/runtime/deployment-profile.ts'
import { createDurableWorkflow, markWorkflowFailed } from '../../src/runtime/workflows.ts'

const now = '2026-09-07T00:00:00.000Z'
const completionBinding = { profileId: 'profile:test', scannedWallet: address(1), signerAddress: address(1) }

function position(status: DurableV3Position['status'] = 'active'): DurableV3Position {
	const owner = address(1)
	const pool = address(20)
	const tickLower = -120
	const tickUpper = 120
	const positionKey = uniswapV3PositionKey(owner, tickLower, tickUpper)
	return {
		createdAt: now,
		creationWorkflowId: 'workflow:seed',
		fee: 3_000,
		id: `${pool.toLowerCase()}:${positionKey.toLowerCase()}`,
		owner,
		pool,
		positionKey,
		profileId: 'profile:test',
		registeredBy: 'workflow',
		status,
		tickLower,
		tickUpper,
		token0: address(21),
		token1: address(22),
	}
}

function request(retirement = initialRetirementState()) {
	const recipient = address(99)
	requestRetirement(retirement, 'profile:test', recipient, DEFAULT_RETIREMENT_POLICIES, `DRAIN profile:test TO ${recipient}`, address(1), now)
	return retirement
}

function v3Anchor(blockNumber: bigint) {
	return { blockHash: hash(Number(blockNumber)), blockNumber }
}

function emptySnapshot() {
	const snapshot = snapshotFixture()
	snapshot.wallet.tokens = []
	snapshot.wallet.shares = []
	snapshot.wallet.lpTokens = []
	snapshot.wallet.openOracleEthCredit = '0'
	for (const pool of snapshot.pools) pool.vaults = []
	for (const pair of snapshot.pairs) pair.walletLiquidity = '0'
	snapshot.warnings = []
	return snapshot
}

function plan(definitionId: string, id = definitionId): OperationPlan {
	return {
		classification: 'selectable',
		createdAtBlock: '1',
		definitionId,
		ecosystem: 'statoblast',
		id,
		label: definitionId,
		metadata: {},
		obligation: false,
		planningSeed: 1,
		postconditions: ['done'],
		priority: 'random',
		risk: 'low',
		steps: [{ data: '0x', evidence: [{ kind: 'receipt-success' }], gasLimit: '1', id: 'step', label: 'step', preflightCalls: [], to: address(30), value: '0', walletAssetDebits: [] }],
	}
}

function evaluation(operation: OperationPlan): EvaluatedOperation {
	return {
		definition: { classification: operation.classification, contract: 'Test', description: 'test', discoveryInputs: [], ecosystem: operation.ecosystem, id: operation.definitionId, label: operation.label, method: 'test', risk: operation.risk },
		eligibility: { blockers: [], eligible: true },
		plan: operation,
	}
}

describe('Drain & Retire state', () => {
	test('requires profile- and recipient-bound confirmation', () => {
		const retirement = initialRetirementState()
		expect(() => requestRetirement(retirement, 'profile:test', address(99), DEFAULT_RETIREMENT_POLICIES, 'DRAIN', address(1))).toThrow()
		expect(retirement.status).toBe('inactive')
	})

	test('rejects zero and durable-signer retirement recipients', () => {
		const signer = address(1)
		const zero = address(0)
		expect(() => requestRetirement(initialRetirementState(), 'profile:test', zero, DEFAULT_RETIREMENT_POLICIES, `DRAIN profile:test TO ${zero}`, undefined)).toThrow('zero address')
		expect(() => requestRetirement(initialRetirementState(), 'profile:test', signer, DEFAULT_RETIREMENT_POLICIES, `DRAIN profile:test TO ${signer}`, signer)).toThrow('durable signer')
	})

	test('persists the requested policy and recipient', () => {
		const retirement = request()
		expect(retirement.status).toBe('requested')
		expect(retirement.recipient).toBe(address(99))
		expect(retirement.requestedAt).toBe(now)
	})

	test('permits cancellation before final sweeping', () => {
		const retirement = request()
		cancelRetirement(retirement, 'CANCEL DRAIN', now)
		expect(retirement.status).toBe('inactive')
		retirement.status = 'draining'
		retirement.finalSweepStartedAt = now
		expect(() => cancelRetirement(retirement, 'CANCEL DRAIN')).toThrow()
	})

	test('computes position identity from owner and tick coordinates', () => {
		expect(uniswapV3PositionKey(address(1), -120, 120)).not.toBe(uniswapV3PositionKey(address(2), -120, 120))
		expect(uniswapV3PositionKey(address(1), -120, 120)).not.toBe(uniswapV3PositionKey(address(1), -60, 60))
	})

	test('registers verified legacy coordinates without trusting liquidity', () => {
		const retirement = initialRetirementState()
		const registered = registerV3Position(retirement, { creationWorkflowId: 'legacy:receipt', fee: 3_000, owner: address(1), pool: address(20), profileId: 'profile:test', tickLower: -120, tickUpper: 120, token0: address(21), token1: address(22) }, now)
		expect(registered.status).toBe('pending-confirmation')
		expect('liquidity' in registered).toBeFalse()
		expect(() => registerV3Position(retirement, { creationWorkflowId: 'legacy:receipt', fee: 3_000, owner: address(1), pool: address(20), profileId: 'profile:test', tickLower: -120, tickUpper: 120, token0: address(21), token1: address(22) }, now)).toThrow()
	})
})

describe('Drain & Retire planning', () => {
	test('fails closed before planning a self or zero-address sweep', () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.ethBalanceAttoEth = '100'
		const limits = { maximumEthAttoEth: 10n, maximumGasCostAttoEth: 1n, maximumRepAttoRep: 10n, minimumEthReserveAttoEth: 1n }
		for (const [recipient, expectedError] of [
			[address(0), 'zero address'],
			[snapshot.wallet.address, 'durable signer'],
		] as const) {
			const retirement = { ...request(), recipient }
			expect(() => buildAssetSweepPlan(snapshot, retirement, 1, limits)).toThrow(expectedError)
			expect(() => buildNativeOpenOracleCreditPlan({ ...snapshot, wallet: { ...snapshot.wallet, openOracleEthCredit: '2' } }, retirement, 1)).toThrow(expectedError)
		}
	})

	test('does not record terminal completion from an unbound zero-wallet scan', async () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.address = address(0)
		snapshot.wallet.ethBalanceAttoEth = '0'
		const state = initialRuntimeState(true, undefined, snapshot.chainId)
		request(state.retirement)
		await expect(
			processRetirementCycle({
				execute: async () => undefined,
				persist: async () => undefined,
				prepareExecution: async () => undefined,
				scan: { anchor: { baseFeePerGas: 1n, blockHash: hash(1), blockNumber: 1n, timestamp: 1n }, canonicalLifecyclePresenceComplete: true, carryProofJournalComplete: true, indexComplete: true, snapshot },
				settings: parseSettings(example),
				state,
				v3: [],
			}),
		).rejects.toThrow('bound signer')
		expect(state.retirement.completionEvidence).toBeUndefined()
		expect(state.retirement.status).not.toBe('drained')
	})
	test('persists a canonical assessment before returning from a paused process cycle', async () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.ethBalanceAttoEth = '0'
		const durable = initialDurableState(snapshot.chainId, true, 'profile:test', snapshot.wallet.address)
		const state = initialRuntimeState(true, snapshot.wallet.address, snapshot.chainId, durable)
		request(state.retirement)
		let persistCount = 0
		const result = await processRetirementCycle({
			execute: async () => {
				throw new Error('Paused retirement must not execute')
			},
			persist: async () => {
				persistCount += 1
			},
			prepareExecution: async () => {
				throw new Error('Paused retirement must not prepare execution')
			},
			scan: { anchor: { baseFeePerGas: 1n, blockHash: hash(1), blockNumber: 1n, timestamp: 1n }, canonicalLifecyclePresenceComplete: true, carryProofJournalComplete: true, indexComplete: true, snapshot },
			settings: parseSettings(example),
			state,
			v3: [],
		})
		expect(result).toBeFalse()
		expect(persistCount).toBe(1)
		expect(state.retirement.blockers).toEqual([])
		expect(state.evaluations.filter(item => item.eligibility.eligible && item.plan !== undefined && operationAllowedDuringRetirement(item.plan.definitionId, state.retirement.policies)).map(item => item.plan?.definitionId)).toEqual([])
		expect(state.retirement.status).toBe('drained')
		expect(state.retirement.completionEvidence).toMatchObject({ blockNumber: '1', profileId: 'profile:test', signerAddress: snapshot.wallet.address })
	})

	test('blocks exposure-creating operations but permits recovery', () => {
		expect(unclassifiedRetirementOperations(CHAOS_OPERATION_CATALOG.map(definition => definition.id))).toEqual([])
		expect(operationAllowedDuringRetirement('statoblast.vault.deposit-rep', DEFAULT_RETIREMENT_POLICIES)).toBeFalse()
		expect(operationAllowedDuringRetirement('zoltar.universe.fork', DEFAULT_RETIREMENT_POLICIES)).toBeFalse()
		expect(operationAllowedDuringRetirement('statoblast.oracle.recover-report', DEFAULT_RETIREMENT_POLICIES)).toBeTrue()
		expect(operationAllowedDuringRetirement('trading.shares.migrate', DEFAULT_RETIREMENT_POLICIES)).toBeFalse()
		expect(operationAllowedDuringRetirement('trading.shares.migrate', { ...DEFAULT_RETIREMENT_POLICIES, migrateExistingClaims: true })).toBeTrue()
		expect(operationAllowedDuringRetirement('trading.position.exit', { ...DEFAULT_RETIREMENT_POLICIES, exitUnmatchedShares: true, maximumExitLossBps: 0 })).toBeTrue()
	})

	test('selects recovery deterministically and one workflow at a time', () => {
		const lowerPriority = plan('statoblast.vault.redeem-fees', 'z')
		const higherPriority = plan('statoblast.escalation.withdraw', 'a')
		expect(retirementPlanFromEvaluations([evaluation(lowerPriority), evaluation(higherPriority)], DEFAULT_RETIREMENT_POLICIES)?.id).toBe('a')
	})

	test('builds full burn then collect from live position liquidity', () => {
		const observation: V3PositionObservation = { liquidity: 77n, position: position(), tokensOwed0: 3n, tokensOwed1: 4n }
		const result = buildV3RetirementPlan(emptySnapshot(), observation, 7)
		expect(result.steps.map(step => step.id)).toEqual(['burn-full-v3-position', 'collect-full-v3-position'])
		expect(result.metadata['positionKey']).toBe(observation.position.positionKey)
	})

	test('builds collect-only positions without a zero-liquidity burn', () => {
		const result = buildV3RetirementPlan(emptySnapshot(), { liquidity: 0n, position: position('collect-only'), tokensOwed0: 1n, tokensOwed1: 0n }, 7)
		expect(result.steps.map(step => step.id)).toEqual(['collect-full-v3-position'])
	})

	test('requires RPC quorum for current position amounts', async () => {
		const current = position()
		const reader = (liquidity: bigint) => async () => ({ liquidity, position: current, tokensOwed0: 2n, tokensOwed1: 3n })
		const observations = await readV3PositionsWithQuorum([reader(5n), reader(5n), reader(9n)], 2, [current], v3Anchor(100n))
		expect(observations[0]).toMatchObject({ liquidity: 5n, tokensOwed0: 2n, tokensOwed1: 3n })
		await expect(readV3PositionsWithQuorum([reader(5n), reader(9n)], 2, [current], v3Anchor(100n))).rejects.toThrow('No RPC quorum')
	})

	test('rejects a competing-fork V3 quorum before recording retirement completion', async () => {
		const canonicalBlockHash = hash(100)
		const competingBlockHash = hash(101)
		const current = position('active')
		const state = initialRuntimeState(true, address(1), 31_337)
		request(state.retirement)
		state.retirement.positions = [current]
		const reader = (endpointBlockHash: `0x${string}`, failPositionRead: boolean) => async (candidate: DurableV3Position, anchor: V3PositionAnchor) => {
			if (endpointBlockHash.toLowerCase() !== anchor.blockHash.toLowerCase()) throw new Error('V3 endpoint does not match the canonical retirement anchor')
			if (failPositionRead) throw new Error('Canonical endpoint V3 read failed')
			return { liquidity: 0n, position: candidate, tokensOwed0: 0n, tokensOwed1: 0n }
		}
		try {
			const observations = await readV3PositionsWithQuorum([reader(canonicalBlockHash, true), reader(canonicalBlockHash, true), reader(competingBlockHash, false), reader(competingBlockHash, false)], 2, [current], {
				blockHash: canonicalBlockHash,
				blockNumber: 100n,
			})
			for (const observation of observations) recordV3ScanSuccess(state, observation, 100n)
		} catch (error) {
			recordV3ScanFailure(state, current, error)
		}
		const assessment = assessRetirement({ blockHash: canonicalBlockHash, blockNumber: 100n, canonicalScanComplete: true, evaluations: [], retirement: state.retirement, snapshot: emptySnapshot(), state, v3: [] })
		applyRetirementAssessment(state.retirement, assessment, canonicalBlockHash, 100n, completionBinding, now)
		expect(current.status).toBe('blocked')
		expect(assessment).toMatchObject({ blockers: [{ category: 'ambiguous-position', id: current.id }], status: 'blocked' })
		expect(state.retirement.completionEvidence).toBeUndefined()
	})

	test('closes a canonically confirmed zeroed workflow position after restart', () => {
		const current = position('pending-confirmation')
		current.creationTransactionHash = hash(44)
		updateV3PositionStatus({ liquidity: 0n, position: current, tokensOwed0: 0n, tokensOwed1: 0n }, 101n)
		expect(current).toMatchObject({ lastCheckedAtBlock: '101', status: 'closed' })
		const unconfirmed = position('pending-confirmation')
		updateV3PositionStatus({ liquidity: 0n, position: unconfirmed, tokensOwed0: 0n, tokensOwed1: 0n }, 102n)
		expect(unconfirmed.status).toBe('pending-confirmation')
	})

	test('retries V3 scan failures and clears the blocker after a later quorum succeeds', async () => {
		const state = initialRuntimeState(true, address(1), 31_337)
		const pending = position('pending-confirmation')
		recordV3ScanFailure(state, pending, new Error('creation receipt is not available yet'))
		expect(pending.status).toBe('pending-confirmation')
		expect(state.retirement.blockers).toContainEqual(expect.objectContaining({ id: pending.id }))
		const active = position('active')
		recordV3ScanFailure(state, active, new Error('No RPC quorum agreed on retirement position'))
		expect(active.status).toBe('blocked')
		const reader = async (current: DurableV3Position) => ({ liquidity: 5n, position: current, tokensOwed0: 2n, tokensOwed1: 3n })
		const observations = await readV3PositionsWithQuorum([reader], 1, [active], v3Anchor(101n))
		expect(observations).toHaveLength(1)
		const observation = observations[0]
		if (observation === undefined) throw new Error('Expected retryable V3 observation')
		recordV3ScanSuccess(state, observation, 101n)
		expect(active).toMatchObject({ lastCheckedAtBlock: '101', status: 'active' })
		expect(state.retirement.blockers).not.toContainEqual(expect.objectContaining({ id: active.id }))
	})

	test('does not equate an empty plan with completion when approvals remain', () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.tokens = [{ address: address(40), allowances: { [address(41)]: '1' }, balance: '0', openOracleCredit: '0', symbol: 'TEST' }]
		const state = initialDurableState(31337)
		const result = assessRetirement({ blockHash: hash(1), blockNumber: 1n, canonicalScanComplete: true, evaluations: [], retirement: request(), snapshot, state, v3: [] })
		expect(result.status).toBe('draining')
		expect(result.proof.knownApprovals).toBe(1)
	})

	test('blocks completion and profile replacement for an unresolved semantic workflow failure', async () => {
		const snapshot = emptySnapshot()
		const workflow = createDurableWorkflow(plan('trading.position.exit', 'semantic-failure'))
		markWorkflowFailed(workflow, 'step', new Error('Canonical postcondition was not proven'), 'semantic-failure')
		const durable = initialDurableState(31_337, true, 'profile:test', snapshot.wallet.address)
		durable.workflows = [workflow]
		const retirement = request(durable.retirement)
		const assessment = assessRetirement({ blockHash: hash(1), blockNumber: 1n, canonicalScanComplete: true, evaluations: [], retirement, snapshot, state: durable, v3: [] })
		expect(assessment).toMatchObject({
			blockers: [{ category: 'operator-action', id: workflow.id }],
			proof: { partialWorkflows: 1 },
			status: 'blocked',
		})
		applyRetirementAssessment(retirement, assessment, hash(1), 1n, completionBinding, now)
		expect(retirement.completionEvidence).toBeUndefined()
		const runtime = initialRuntimeState(true, snapshot.wallet.address, 31_337, durable)
		await expect(resetPristineStateForDeploymentProfile(runtime, 'profile:replacement', true, snapshot.wallet.address, '/tmp/retirement-state.json', async () => undefined)).rejects.toThrow('drain it first')
	})

	test('revokes ERC-20, ERC-1155, and LP approvals one deterministic target at a time', () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.tokens = [{ address: address(40), allowances: {}, balance: '0', openOracleCredit: '0', openOracleInternalAllowanceToSelf: '1', symbol: 'TEST' }]
		expect(buildAllowanceRevocationPlan(snapshot, 1)?.definitionId).toBe('retirement.allowance.revoke-open-oracle-internal')
		snapshot.wallet.tokens = [{ address: address(40), allowances: { [address(41)]: '1' }, balance: '0', openOracleCredit: '0', symbol: 'TEST' }]
		expect(buildAllowanceRevocationPlan(snapshot, 1)?.definitionId).toBe('retirement.allowance.revoke-erc20')
		snapshot.wallet.tokens = []
		snapshot.wallet.shares = [{ invalid: '0', isApprovedForAll: { [address(42)]: true }, migrationProgressByRoute: {}, no: '0', shareToken: address(43), universeId: '1', yes: '0' }]
		expect(buildAllowanceRevocationPlan(snapshot, 1)?.definitionId).toBe('retirement.allowance.revoke-erc1155')
		snapshot.wallet.shares = []
		snapshot.wallet.lpTokens = [{ allowanceToRouter: '1', balance: '0', pair: address(44) }]
		expect(buildAllowanceRevocationPlan(snapshot, 1)?.definitionId).toBe('retirement.allowance.revoke-lp')
	})

	test('withdraws native OpenOracle credit to exactly its sentinel', () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.openOracleEthCredit = '9'
		const withdrawal = buildNativeOpenOracleCreditPlan(snapshot, request(), 0)
		expect(withdrawal).toMatchObject({ definitionId: 'retirement.open-oracle.withdraw-native', metadata: { amount: '8' } })
		expect(withdrawal?.steps[0]?.evidence).toContainEqual(expect.objectContaining({ expected: '1', functionName: 'tokenHolder' }))
	})

	test('enforces the configured unmatched-share loss against guaranteed output', () => {
		const exit = plan('trading.position.exit')
		const minimumEthAttoEth = 970n
		exit.metadata = { maximumLong: '1000', minimumEthAttoEth: minimumEthAttoEth.toString() }
		const policies = { ...DEFAULT_RETIREMENT_POLICIES, exitUnmatchedShares: true }
		expect(retirementPlanFromEvaluations([evaluation(exit)], { ...policies, maximumExitLossBps: 250 })).toBeUndefined()
		expect(retirementPlanFromEvaluations([evaluation(exit)], { ...policies, maximumExitLossBps: 300 })).toBe(exit)
	})

	test('does not hide retained WETH or pending V3 verification in a drained proof', () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.tokens = [{ address: snapshot.deployments.weth, allowances: {}, balance: '3', openOracleCredit: '0', symbol: 'WETH' }]
		const retirement = request()
		retirement.policies.unwrapWeth = false
		retirement.positions = [position('pending-confirmation')]
		const result = assessRetirement({ blockHash: hash(1), blockNumber: 1n, canonicalScanComplete: true, evaluations: [], retirement, snapshot, state: initialDurableState(31337), v3: [] })
		expect(result.status).toBe('blocked')
		expect(result.residuals).toContainEqual(expect.objectContaining({ amount: '3', category: 'operator-accepted' }))
		expect(result.blockers).toContainEqual(expect.objectContaining({ category: 'ambiguous-position', id: retirement.positions[0]?.id }))
	})

	test('does not hide custom LP or existing migration claims from completion', () => {
		const snapshot = emptySnapshot()
		const retirement = request()
		snapshot.wallet.lpTokens = [{ allowanceToRouter: '0', balance: '3', pair: address(81) }]
		let result = assessRetirement({ blockHash: hash(1), blockNumber: 1n, canonicalScanComplete: true, evaluations: [], retirement, snapshot, state: initialDurableState(31337), v3: [] })
		expect(result).toMatchObject({ proof: { claimableAssets: 1 }, status: 'blocked' })
		snapshot.wallet.lpTokens = []
		const universe = snapshot.universes[0]
		if (universe === undefined) throw new Error('Universe fixture is missing')
		universe.migrationBalance = '4'
		result = assessRetirement({ blockHash: hash(2), blockNumber: 2n, canonicalScanComplete: true, evaluations: [], retirement, snapshot, state: initialDurableState(31337), v3: [] })
		expect(result).toMatchObject({ residuals: [{ amount: '4', category: 'irreversible-burn' }], status: 'drained-with-residuals' })
		retirement.policies.migrateExistingClaims = true
		result = assessRetirement({ blockHash: hash(3), blockNumber: 3n, canonicalScanComplete: true, evaluations: [], retirement, snapshot, state: initialDurableState(31337), v3: [] })
		expect(result).toMatchObject({ proof: { claimableAssets: 1 }, status: 'blocked' })
	})

	test('removes the full custom LP balance above ordinary chaos caps', () => {
		const snapshot = snapshotFixture()
		const pair = snapshot.pairs[0]
		if (pair === undefined) throw new Error('Trading pair fixture is missing')
		pair.walletLiquidity = '2000000000000000'
		pair.totalSupply = '4000000000000000'
		snapshot.wallet.lpTokens = [{ allowanceToRouter: '0', balance: pair.walletLiquidity, pair: pair.address }]
		const plan = buildRetirementLiquidityRemovalPlan(snapshot, { maximumBlockIntervalSeconds: 15, seed: 1, workflowValidForBlocks: 288 })
		expect(plan?.metadata['liquidity']).toBe(pair.walletLiquidity)
		expect(plan?.planningSeed).toBe(1)
		expect(plan?.steps.map(step => step.id)).toEqual(['approve-lp', 'removeLiquidity'])
	})

	test('unwraps WETH, sweeps tokens in bounded chunks, and sends native ETH last above reserve', () => {
		const snapshot = emptySnapshot()
		const retirement = request()
		const limits = { maximumEthAttoEth: 10n, maximumGasCostAttoEth: 1n, maximumRepAttoRep: 5n, minimumEthReserveAttoEth: 3n }
		snapshot.wallet.tokens = [{ address: snapshot.deployments.weth, allowances: {}, balance: '12', openOracleCredit: '0', symbol: 'WETH' }]
		expect(buildAssetSweepPlan(snapshot, retirement, 1, limits)).toMatchObject({ definitionId: 'retirement.sweep.unwrap-weth', metadata: { amount: '10' } })
		snapshot.wallet.tokens = [{ address: snapshot.universes[0]?.repToken ?? address(10), allowances: {}, balance: '12', openOracleCredit: '0', symbol: 'REP' }]
		expect(buildAssetSweepPlan(snapshot, retirement, 1, limits)).toMatchObject({ definitionId: 'retirement.sweep.erc20', metadata: { amount: '5' } })
		snapshot.wallet.tokens = []
		snapshot.wallet.ethBalanceAttoEth = '20'
		expect(buildAssetSweepPlan(snapshot, retirement, 1, limits)).toMatchObject({ definitionId: 'retirement.sweep.native-last', metadata: { amount: '10' } })
	})

	test('reserves both configured ETH and the maximum gas cost before a native final sweep', () => {
		const snapshot = emptySnapshot()
		const retirement = request()
		const limits = { maximumEthAttoEth: 100n, maximumGasCostAttoEth: 4n, maximumRepAttoRep: 5n, minimumEthReserveAttoEth: 3n }
		snapshot.wallet.ethBalanceAttoEth = '20'
		const sweep = buildAssetSweepPlan(snapshot, retirement, 1, limits)
		expect(sweep).toMatchObject({ definitionId: 'retirement.sweep.native-last', metadata: { amount: '13' } })
		if (sweep === undefined) throw new Error('Expected a native sweep plan')
		expect(assertOperationEthFunding(sweep, 20n, limits)).toEqual({ maximumGasCost: 4n, requiredBalance: 20n, transactionValue: 13n })
	})

	test('does not execute retirement actions until canonical lifecycle discovery is complete', async () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.tokens = [{ address: address(40), allowances: { [address(41)]: '1' }, balance: '0', openOracleCredit: '0', symbol: 'TEST' }]
		const state = initialRuntimeState(false, snapshot.wallet.address, snapshot.chainId)
		request(state.retirement)
		const settings = parseSettings(example)
		settings.paused = false
		settings.runtime.execute = true
		let executed = false
		await processRetirementCycle({
			execute: async () => {
				executed = true
			},
			persist: async () => {},
			prepareExecution: async () => {},
			scan: { anchor: { baseFeePerGas: 1n, blockHash: hash(1), blockNumber: 1n, timestamp: 1n }, canonicalLifecyclePresenceComplete: false, carryProofJournalComplete: true, indexComplete: true, snapshot },
			settings,
			state,
			v3: [],
		})
		expect(executed).toBeFalse()
		expect(state.retirement).toMatchObject({ blockers: [{ id: 'canonical-scan-incomplete' }], status: 'blocked' })
	})

	test('waits for delayed obligations and blocks ambiguous ownership', () => {
		const snapshot = emptySnapshot()
		const state = initialDurableState(31337)
		state.obligations.push({
			automaticRetryCount: 0,
			attemptCount: 0,
			blockers: [],
			createdAt: now,
			ecosystem: 'statoblast',
			id: 'obligation:delayed',
			label: 'Delayed claim',
			metadata: {},
			notBefore: '2026-09-08T00:00:00.000Z',
			operationId: 'statoblast.escalation.withdraw',
			status: 'deferred',
			updatedAt: now,
			workflowId: 'workflow:missing',
		})
		const waiting = assessRetirement({ blockHash: hash(1), blockNumber: 1n, canonicalScanComplete: true, evaluations: [], retirement: request(), snapshot, state, v3: [] })
		expect(waiting).toMatchObject({ status: 'waiting', blockers: [{ category: 'temporarily-locked', nextEligibleAt: '2026-09-08T00:00:00.000Z' }] })
		const delayed = state.obligations[0]
		if (delayed === undefined) throw new Error('Delayed obligation fixture is missing')
		delayed.status = 'pending'
		delete delayed.notBefore
		const actionable = assessRetirement({ blockHash: hash(2), blockNumber: 2n, canonicalScanComplete: true, evaluations: [evaluation(plan('statoblast.escalation.withdraw'))], retirement: request(), snapshot, state, v3: [] })
		expect(actionable).toMatchObject({ action: { kind: 'existing-plan', plan: { definitionId: 'statoblast.escalation.withdraw' } }, status: 'draining' })
		state.obligations = []
		const retirement = request()
		retirement.positions = [position('blocked')]
		expect(assessRetirement({ blockHash: hash(1), blockNumber: 1n, canonicalScanComplete: true, evaluations: [], retirement, snapshot, state, v3: [] }).status).toBe('blocked')
	})

	test('records exact completion proof and residual completion separately', () => {
		const snapshot = emptySnapshot()
		const state = initialDurableState(31337)
		const retirement = request()
		const incomplete = assessRetirement({ blockHash: hash(0), blockNumber: 0n, canonicalScanComplete: false, evaluations: [], retirement, snapshot, state, v3: [] })
		expect(incomplete).toMatchObject({ blockers: [{ id: 'canonical-scan-incomplete' }], status: 'blocked' })
		const clean = assessRetirement({ blockHash: hash(1), blockNumber: 1n, canonicalScanComplete: true, evaluations: [], retirement, snapshot, state, v3: [] })
		expect(clean.status).toBe('drained')
		applyRetirementAssessment(retirement, clean, hash(1), 1n, completionBinding, now)
		expect(retirement.completionEvidence?.proof.pendingTransactions).toBe(0)

		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture is missing')
		pool.questionOutcome = 1
		snapshot.wallet.shares = [{ invalid: '0', isApprovedForAll: {}, migrationProgressByRoute: {}, no: '4', shareToken: pool.shareToken, universeId: pool.universeId, yes: '0' }]
		const residual = assessRetirement({ blockHash: hash(2), blockNumber: 2n, canonicalScanComplete: true, evaluations: [], retirement, snapshot, state, v3: [] })
		expect(residual.status).toBe('drained-with-residuals')
	})

	test('binds a residual replacement override to current completion evidence, profile, and recipient', async () => {
		const snapshot = emptySnapshot()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture is missing')
		pool.questionOutcome = 1
		snapshot.wallet.shares = [{ invalid: '0', isApprovedForAll: {}, migrationProgressByRoute: {}, no: '4', shareToken: pool.shareToken, universeId: pool.universeId, yes: '0' }]
		const retirement = request()
		const residual = assessRetirement({ blockHash: hash(2), blockNumber: 2n, canonicalScanComplete: true, evaluations: [], retirement, snapshot, state: initialDurableState(31337), v3: [] })
		applyRetirementAssessment(retirement, residual, hash(2), 2n, completionBinding, now)
		acceptResidualProfileReplacement(retirement, 'profile:test', 'profile:replacement', 'Residual share loss was reviewed and accepted.', 'ACCEPT RESIDUALS FOR profile:replacement', now)
		expect(retirement.profileReplacementOverride).toMatchObject({ completionBlockHash: hash(2), completionBlockNumber: '2', recipient: address(99), sourceProfileId: 'profile:test', targetProfileId: 'profile:replacement' })

		const mismatchedRuntime = initialRuntimeState(true, snapshot.wallet.address, 31_337)
		mismatchedRuntime.profileId = 'profile:other'
		mismatchedRuntime.retirement = structuredClone(retirement)
		await expect(resetPristineStateForDeploymentProfile(mismatchedRuntime, 'profile:replacement', true, snapshot.wallet.address, '/tmp/retirement-state.json', async () => undefined)).rejects.toThrow('drain it first')

		const runtime = initialRuntimeState(true, snapshot.wallet.address, 31_337)
		runtime.profileId = 'profile:test'
		runtime.signerAddress = snapshot.wallet.address
		runtime.retirement = structuredClone(retirement)
		const mismatchedSigner = structuredClone(runtime)
		if (mismatchedSigner.retirement.completionEvidence === undefined) throw new Error('Completion evidence fixture is missing')
		Object.assign(mismatchedSigner.retirement.completionEvidence, { profileId: 'profile:test', signerAddress: address(44) })
		await expect(resetPristineStateForDeploymentProfile(mismatchedSigner, 'profile:replacement', true, snapshot.wallet.address, '/tmp/retirement-state.json', async () => undefined)).rejects.toThrow('signer')
		expect(mismatchedSigner.profileId).toBe('profile:test')

		const changedHash = structuredClone(runtime)
		const beforeRejectedReset = structuredClone(changedHash)
		await expect(
			resetPristineStateForDeploymentProfile(changedHash, 'profile:replacement', true, snapshot.wallet.address, '/tmp/retirement-state.json', async () => {
				throw new Error('Completion block is not finalized or is no longer canonical')
			}),
		).rejects.toThrow('not finalized')
		expect(changedHash).toEqual(beforeRejectedReset)

		const singleReaderSettings = parseSettings({
			...example,
			connectivity: { publicRpcUrls: ['https://submit.example'], quorumRpcUrls: [], readRpcUrl: 'https://read.example', rpcQuorum: 1 },
			networkConfigured: true,
		})
		const singleReaderReset = structuredClone(runtime)
		const beforeSingleReaderReset = structuredClone(singleReaderReset)
		await expect(resetPristineStateForDeploymentProfile(singleReaderReset, 'profile:replacement', true, snapshot.wallet.address, '/tmp/retirement-state.json', async evidence => verifyRetirementCompletionFinality(singleReaderSettings, evidence))).rejects.toThrow('two independent RPC readers')
		expect(singleReaderReset).toEqual(beforeSingleReaderReset)

		expect(await resetPristineStateForDeploymentProfile(runtime, 'profile:replacement', true, snapshot.wallet.address, '/tmp/retirement-state.json', async () => undefined)).toBeTrue()

		applyRetirementAssessment(retirement, residual, hash(3), 3n, completionBinding, '2026-09-07T00:01:00.000Z')
		expect(retirement.profileReplacementOverride).toBeUndefined()
	})

	test('persists cumulative canonical balance increases across recovery and sweeping', () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.ethBalanceAttoEth = '10'
		snapshot.wallet.tokens = [{ address: address(40), allowances: {}, balance: '3', openOracleCredit: '0', symbol: 'REP' }]
		snapshot.wallet.lpTokens = [{ allowanceToRouter: '0', balance: '2', pair: address(41) }]
		const retirement = initialRetirementState()
		recordCanonicalRecoveredBalances(retirement, snapshot)
		expect(retirement.recoveredBalances).toEqual({})
		const token = snapshot.wallet.tokens[0]
		const lpToken = snapshot.wallet.lpTokens[0]
		if (token === undefined || lpToken === undefined) throw new Error('Recovery balance fixture is incomplete')
		snapshot.wallet.ethBalanceAttoEth = '15'
		token.balance = '7'
		lpToken.balance = '5'
		recordCanonicalRecoveredBalances(retirement, snapshot)
		expect(retirement.recoveredBalances).toEqual({ ETH: '5', [address(40)]: '4', [`LP:${address(41)}`]: '3' })
		snapshot.wallet.ethBalanceAttoEth = '12'
		token.balance = '2'
		recordCanonicalRecoveredBalances(retirement, snapshot)
		snapshot.wallet.ethBalanceAttoEth = '18'
		token.balance = '6'
		recordCanonicalRecoveredBalances(retirement, snapshot)
		expect(retirement.recoveredBalances).toEqual({ ETH: '11', [address(40)]: '8', [`LP:${address(41)}`]: '3' })
	})

	test('backfills confirmed seed workflows and blocks ambiguous older workflows', async () => {
		const workflow = (status: DurableWorkflow['steps'][number]['status'], id: string): DurableWorkflow => {
			let pool = 62
			if (id === 'confirmed') pool = 60
			else if (id === 'pending') pool = 61
			let workflowStatus: DurableWorkflow['status'] = 'failed'
			if (status === 'confirmed') workflowStatus = 'completed'
			else if (status === 'signed' || status === 'submitted' || status === 'planned') workflowStatus = 'waiting-transaction'
			return {
				classification: 'selectable',
				createdAt: now,
				createdAtBlock: '1',
				ecosystem: 'trading',
				id,
				label: 'seed',
				metadata: { pool: address(pool), token0: address(63), token1: address(64) },
				obligation: false,
				operationId: 'trading.genesis-uniswap.seed-pool',
				planId: `plan:${id}`,
				planningSeed: 1,
				postconditions: ['seeded'],
				priority: 'random',
				risk: 'medium',
				status: workflowStatus,
				steps: [
					{
						confirmedAt: status === 'confirmed' ? now : undefined,
						data: '0x',
						evidence: [{ kind: 'receipt-success' }],
						gasLimit: '1',
						id: 'seed-genesis-uniswap-pool',
						label: 'seed',
						preflightCalls: [],
						status,
						to: address(65),
						transactionHash: status === 'confirmed' ? hash(9) : undefined,
						value: '0',
						walletAssetDebits: [],
					},
				],
				updatedAt: now,
			}
		}
		const retirement = initialRetirementState()
		const pending = workflow('signed', 'pending')
		reconcileV3PositionJournal(retirement, [workflow('confirmed', 'confirmed'), pending, workflow('failed', 'ambiguous')], 'profile:test', address(1), now)
		expect(retirement.positions.map(candidate => candidate.status)).toEqual(['active', 'pending-confirmation', 'blocked'])
		const pendingPosition = retirement.positions[1]
		if (pendingPosition === undefined) throw new Error('Pending position was not journaled')
		expect(await readV3PositionsWithQuorum([async candidate => ({ liquidity: 1n, position: candidate, tokensOwed0: 0n, tokensOwed1: 0n })], 1, [pendingPosition], v3Anchor(1n))).toHaveLength(1)
		const seed = pending.steps[0]
		if (seed === undefined) throw new Error('Seed workflow step is missing')
		seed.status = 'confirmed'
		seed.transactionHash = hash(10)
		pending.status = 'completed'
		reconcileV3PositionJournal(retirement, [pending], 'profile:test', address(1), now)
		expect(retirement.positions[1]).toMatchObject({ creationTransactionHash: hash(10), status: 'active' })
	})
})
