import { describe, expect, test } from 'bun:test'
import { address, hash, snapshotFixture } from '../operations/fixture.ts'
import { buildRetirementLiquidityRemovalPlan } from '../../src/operations/trading.ts'
import {
	applyRetirementAssessment,
	assessRetirement,
	buildAllowanceRevocationPlan,
	buildAssetSweepPlan,
	buildV3RetirementPlan,
	operationAllowedDuringRetirement,
	readV3PositionsWithQuorum,
	reconcileV3PositionJournal,
	recordCanonicalRecoveredBalances,
	retirementPlanFromEvaluations,
	type V3PositionObservation,
} from '../../src/runtime/retirement.ts'
import { initialDurableState, type DurableWorkflow } from '../../src/state/operator-state.ts'
import { cancelRetirement, DEFAULT_RETIREMENT_POLICIES, initialRetirementState, registerV3Position, requestRetirement, uniswapV3PositionKey, type DurableV3Position } from '../../src/state/retirement.ts'
import type { EvaluatedOperation, OperationPlan } from '../../src/operations/types.ts'

const now = '2026-09-07T00:00:00.000Z'

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
	requestRetirement(retirement, 'profile:test', recipient, DEFAULT_RETIREMENT_POLICIES, `DRAIN profile:test TO ${recipient}`, now)
	return retirement
}

function emptySnapshot() {
	const snapshot = snapshotFixture()
	snapshot.wallet.tokens = []
	snapshot.wallet.shares = []
	snapshot.wallet.lpTokens = []
	snapshot.wallet.openOracleEthCredit = '0'
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
		expect(() => requestRetirement(retirement, 'profile:test', address(99), DEFAULT_RETIREMENT_POLICIES, 'DRAIN')).toThrow()
		expect(retirement.status).toBe('inactive')
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
	test('blocks exposure-creating operations but permits recovery', () => {
		expect(operationAllowedDuringRetirement('statoblast.vault.deposit-rep', DEFAULT_RETIREMENT_POLICIES)).toBeFalse()
		expect(operationAllowedDuringRetirement('zoltar.universe.fork', DEFAULT_RETIREMENT_POLICIES)).toBeFalse()
		expect(operationAllowedDuringRetirement('statoblast.oracle.recover-report', DEFAULT_RETIREMENT_POLICIES)).toBeTrue()
		expect(operationAllowedDuringRetirement('trading.shares.migrate', DEFAULT_RETIREMENT_POLICIES)).toBeFalse()
		expect(operationAllowedDuringRetirement('trading.shares.migrate', { ...DEFAULT_RETIREMENT_POLICIES, migrateExistingClaims: true })).toBeTrue()
		expect(operationAllowedDuringRetirement('trading.position.exit', { ...DEFAULT_RETIREMENT_POLICIES, exitUnmatchedShares: true, maximumExitLossBps: 99 })).toBeFalse()
		expect(operationAllowedDuringRetirement('trading.position.exit', { ...DEFAULT_RETIREMENT_POLICIES, exitUnmatchedShares: true, maximumExitLossBps: 100 })).toBeTrue()
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
		const observations = await readV3PositionsWithQuorum([reader(5n), reader(5n), reader(9n)], 2, [current], 100n)
		expect(observations[0]).toMatchObject({ liquidity: 5n, tokensOwed0: 2n, tokensOwed1: 3n })
		await expect(readV3PositionsWithQuorum([reader(5n), reader(9n)], 2, [current], 100n)).rejects.toThrow('No RPC quorum')
	})

	test('does not equate an empty plan with completion when approvals remain', () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.tokens = [{ address: address(40), allowances: { [address(41)]: '1' }, balance: '0', openOracleCredit: '0', symbol: 'TEST' }]
		const state = initialDurableState(31337)
		const result = assessRetirement({ blockHash: hash(1), blockNumber: 1n, evaluations: [], retirement: request(), snapshot, state, v3: [] })
		expect(result.status).toBe('draining')
		expect(result.proof.knownApprovals).toBe(1)
	})

	test('revokes ERC-20, ERC-1155, and LP approvals one deterministic target at a time', () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.tokens = [{ address: address(40), allowances: { [address(41)]: '1' }, balance: '0', openOracleCredit: '0', symbol: 'TEST' }]
		expect(buildAllowanceRevocationPlan(snapshot, 1)?.definitionId).toBe('retirement.allowance.revoke-erc20')
		snapshot.wallet.tokens = []
		snapshot.wallet.shares = [{ invalid: '0', isApprovedForAll: { [address(42)]: true }, migrationProgressByRoute: {}, no: '0', shareToken: address(43), universeId: '1', yes: '0' }]
		expect(buildAllowanceRevocationPlan(snapshot, 1)?.definitionId).toBe('retirement.allowance.revoke-erc1155')
		snapshot.wallet.shares = []
		snapshot.wallet.lpTokens = [{ allowanceToRouter: '1', balance: '0', pair: address(44) }]
		expect(buildAllowanceRevocationPlan(snapshot, 1)?.definitionId).toBe('retirement.allowance.revoke-lp')
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
		expect(plan?.steps.map(step => step.id)).toEqual(['approve-lp', 'removeLiquidity'])
	})

	test('unwraps WETH, sweeps tokens in bounded chunks, and sends native ETH last above reserve', () => {
		const snapshot = emptySnapshot()
		const retirement = request()
		const limits = { maximumEthAttoEth: 10n, maximumRepAttoRep: 5n, minimumEthReserveAttoEth: 3n }
		snapshot.wallet.tokens = [{ address: snapshot.deployments.weth, allowances: {}, balance: '12', openOracleCredit: '0', symbol: 'WETH' }]
		expect(buildAssetSweepPlan(snapshot, retirement, 1, limits)).toMatchObject({ definitionId: 'retirement.sweep.unwrap-weth', metadata: { amount: '10' } })
		snapshot.wallet.tokens = [{ address: snapshot.universes[0]?.repToken ?? address(10), allowances: {}, balance: '12', openOracleCredit: '0', symbol: 'REP' }]
		expect(buildAssetSweepPlan(snapshot, retirement, 1, limits)).toMatchObject({ definitionId: 'retirement.sweep.erc20', metadata: { amount: '5' } })
		snapshot.wallet.tokens = []
		snapshot.wallet.ethBalanceAttoEth = '20'
		expect(buildAssetSweepPlan(snapshot, retirement, 1, limits)).toMatchObject({ definitionId: 'retirement.sweep.native-last', metadata: { amount: '10' } })
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
		const waiting = assessRetirement({ blockHash: hash(1), blockNumber: 1n, evaluations: [], retirement: request(), snapshot, state, v3: [] })
		expect(waiting).toMatchObject({ status: 'waiting', blockers: [{ category: 'temporarily-locked', nextEligibleAt: '2026-09-08T00:00:00.000Z' }] })
		state.obligations = []
		const retirement = request()
		retirement.positions = [position('blocked')]
		expect(assessRetirement({ blockHash: hash(1), blockNumber: 1n, evaluations: [], retirement, snapshot, state, v3: [] }).status).toBe('blocked')
	})

	test('records exact completion proof and residual completion separately', () => {
		const snapshot = emptySnapshot()
		const state = initialDurableState(31337)
		const retirement = request()
		const clean = assessRetirement({ blockHash: hash(1), blockNumber: 1n, evaluations: [], retirement, snapshot, state, v3: [] })
		expect(clean.status).toBe('drained')
		applyRetirementAssessment(retirement, clean, hash(1), 1n, now)
		expect(retirement.completionEvidence?.proof.pendingTransactions).toBe(0)

		snapshot.wallet.shares = [{ invalid: '0', isApprovedForAll: {}, migrationProgressByRoute: {}, no: '4', shareToken: address(50), universeId: '1', yes: '0' }]
		const residual = assessRetirement({ blockHash: hash(2), blockNumber: 2n, evaluations: [], retirement, snapshot, state, v3: [] })
		expect(residual.status).toBe('drained-with-residuals')
	})

	test('persists the latest canonical recovered wallet balances', () => {
		const snapshot = emptySnapshot()
		snapshot.wallet.ethBalanceAttoEth = '12'
		snapshot.wallet.tokens = [{ address: address(40), allowances: {}, balance: '7', openOracleCredit: '0', symbol: 'REP' }]
		snapshot.wallet.lpTokens = [{ allowanceToRouter: '0', balance: '5', pair: address(41) }]
		const retirement = initialRetirementState()
		recordCanonicalRecoveredBalances(retirement, snapshot)
		expect(retirement.recoveredBalances).toEqual({ ETH: '12', [address(40)]: '7', [`LP:${address(41)}`]: '5' })
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
		expect(
			await readV3PositionsWithQuorum(
				[
					async () => {
						throw new Error('pending positions must not be read')
					},
				],
				1,
				[retirement.positions[1] as DurableV3Position],
				1n,
			),
		).toEqual([])
		const seed = pending.steps[0]
		if (seed === undefined) throw new Error('Seed workflow step is missing')
		seed.status = 'confirmed'
		seed.transactionHash = hash(10)
		pending.status = 'completed'
		reconcileV3PositionJournal(retirement, [pending], 'profile:test', address(1), now)
		expect(retirement.positions[1]).toMatchObject({ creationTransactionHash: hash(10), status: 'active' })
	})
})
