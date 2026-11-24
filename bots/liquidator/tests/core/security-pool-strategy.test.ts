import { expect, test } from 'bun:test'
import { securityPoolCureOutcome } from '../../src/core/security-pool-cure-state.ts'
import { SIGNED_TRANSACTION_SLOT_SECONDS, securityPoolTakeoverPlan } from '../../src/core/security-pool-strategy.ts'
import { DEFAULT_TRANSACTION_VALIDITY_BLOCKS } from '@zoltar/bot-shared/execution/transaction-submission'
import { assertSecurityPoolPlanStillAllowed } from '../../src/execution/security-pool-executor.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { securityPoolScanMetrics } from '../../src/state/security-pool-view.ts'
import { ownerAddress, securityPoolObservation, securityPoolSettings, unit } from '../support/security-pool-observation.ts'

function evaluate(observation = securityPoolObservation(), settings = securityPoolSettings(), totalPrincipal = observation.snapshot.ownerPrincipalAttoRep, marketAllowed = true) {
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	return securityPoolTakeoverPlan(observation, position, settings, totalPrincipal, marketAllowed)
}

test('funded takeover bounds the entire transferred obligation, owner collateral without upfront ETH funding', () => {
	const plan = evaluate().plan
	expect(plan).toMatchObject({ commitment: 100n * unit, minimumTakeoverReward: 99n * unit, ownFunding: (585n * unit) / 10n, maximumOwnRep: (585n * unit) / 10n, maximumOwnerPrincipal: 1000n * unit, expectedSourceBatch: 0n })
	expect(plan?.netRewardAttoEth).toBeGreaterThan(0n)
})

test('scan metrics use active security pool observations', () => {
	const settings = securityPoolSettings()
	const state = initialRuntimeState(true, ownerAddress, settings.network.chainId)
	const eligible = securityPoolObservation()
	const inactive = securityPoolObservation()
	inactive.snapshot.forkTime = 1n
	const unselected = securityPoolObservation()
	unselected.selected = false
	state.securityPools = [eligible, inactive, unselected]
	expect(state.pools).toHaveLength(0)
	expect(securityPoolScanMetrics(state, settings)).toMatchObject({ poolCount: 3, selectedPoolCount: 2, eligiblePoolCount: 1 })
})

test('an independently accounted auction vault controlled by the keeper is not an external profit opportunity', () => {
	const observation = securityPoolObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture target missing')
	Object.assign(position, { controllingOwner: observation.snapshot.owner })
	expect(evaluate(observation).plan).toBeUndefined()
})

test('unapproved, deselected, forked and independent-price failures cannot produce actions', () => {
	for (const mutation of [
		(value: ReturnType<typeof securityPoolObservation>) => {
			value.approvedUniverse = false
		},
		(value: ReturnType<typeof securityPoolObservation>) => {
			value.selected = false
		},
		(value: ReturnType<typeof securityPoolObservation>) => {
			value.snapshot.forkTime = 1n
		},
		(value: ReturnType<typeof securityPoolObservation>) => {
			value.snapshot.importing = true
		},
	]) {
		const observation = securityPoolObservation()
		mutation(observation)
		expect(evaluate(observation).plan).toBeUndefined()
	}
	expect(evaluate(securityPoolObservation(), securityPoolSettings(), 0n, false).plan).toBeUndefined()
})

test('an already-started auction remains actionable across price expiry and the signed validity window', () => {
	const horizon = DEFAULT_TRANSACTION_VALIDITY_BLOCKS * SIGNED_TRANSACTION_SLOT_SECONDS
	for (const offset of [-1n, 0n, 1n, horizon]) {
		const observation = securityPoolObservation()
		observation.snapshot.timestamp = observation.snapshot.priceValidUntil - offset
		observation.snapshot.priceValid = offset > 0n
		expect(evaluate(observation).plan).toBeDefined()
		const position = observation.positions[0]
		if (position === undefined) throw new Error('Fixture target missing')
		position.liquidationStarted = 0n
		expect(evaluate(observation).plan).toBeUndefined()
	}
	const observation = securityPoolObservation()
	observation.snapshot.timestamp = observation.snapshot.priceValidUntil - horizon - 1n
	expect(evaluate(observation).plan).toBeDefined()
})

test('receiver cohort and exact health consent are required; dust spare capacity cannot block takeover', () => {
	const observation = securityPoolObservation()
	observation.snapshot.ownerAccount.targetHealthFactorBps = 10_000n
	expect(evaluate(observation).reason).toContain('health target')
	observation.snapshot.ownerAccount.targetHealthFactorBps = 15_000n
	observation.snapshot.positions = [{ id: 2n, owner: observation.snapshot.owner, batch: 2n, rep: unit, commitment: unit, maxHealthyPrice: unit, releasedRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, liquidationStarted: 0n, remainingCommitment: 0n, retirementPreview: undefined }]
	expect(evaluate(observation).reason).toContain('cohorts differ')
	observation.snapshot.positions = []
	observation.snapshot.demandAttoEth--
	expect(evaluate(observation).plan).toBeDefined()
})

test('managed scopes, projected income, principal and commitment caps, wallet gas are enforced', () => {
	const settings = securityPoolSettings()
	settings.securityPoolPolicy.maximumPrincipalAttoRep = 8n * unit
	expect(evaluate(securityPoolObservation(), settings).reason).toContain('principal exposure')
	settings.securityPoolPolicy.maximumPrincipalAttoRep = 1000n * unit
	expect(evaluate(securityPoolObservation(), settings, 1995n * unit).reason).toContain('principal exposure')
	settings.securityPoolPolicy.maximumCommitmentAttoEth = 5n * unit
	expect(evaluate(securityPoolObservation(), settings).reason).toContain('commitment limit')
	settings.securityPoolPolicy.maximumCommitmentAttoEth = 1000n * unit
	settings.securityPoolPolicy.maximumOwnFundingAttoRep = unit
	expect(evaluate(securityPoolObservation(), settings).reason).toContain('Own REP funding')
	settings.securityPoolPolicy.maximumOwnFundingAttoRep = 1000n * unit
	const observation = securityPoolObservation()
	observation.walletAttoEth = 0n
	expect(evaluate(observation, settings).reason).toContain('gas reserve')
	observation.walletAttoEth = 10n * unit
	observation.walletRep = 0n
	expect(evaluate(observation, settings).reason).toContain('Wallet REP')
})

test('each prerequisite is followed by fresh funding, cohort, exposure and takeover reward revalidation', () => {
	const plan = evaluate().plan
	if (plan === undefined) throw new Error('Fixture plan missing')
	expect(() => assertSecurityPoolPlanStillAllowed(plan, { ...plan, ownFunding: plan.ownFunding + 1n }, 'principal')).toThrow('funding requirement')
	expect(() => assertSecurityPoolPlanStillAllowed(plan, { ...plan, expectedSourceBatch: 2n }, 'approval')).toThrow('cohort')
	expect(() => assertSecurityPoolPlanStillAllowed(plan, { ...plan, maximumOwnerPrincipal: plan.maximumOwnerPrincipal - 1n }, 'principal')).toThrow('exposure')
	const funded = { ...plan, ownFunding: 0n }
	expect(() => assertSecurityPoolPlanStillAllowed(funded, { ...funded, minimumTakeoverReward: funded.minimumTakeoverReward - 1n }, 'takeover')).toThrow('terms')
	expect(() => assertSecurityPoolPlanStillAllowed(funded, { ...funded, ownFunding: 1n }, 'takeover')).toThrow('terms')
	expect(() => assertSecurityPoolPlanStillAllowed(funded, funded, 'takeover')).not.toThrow()
})

test('atomic takeover can remove unpaid spare commitment and acquire the still unhealthy residual', () => {
	const observation = securityPoolObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	position.rep = 105n * unit
	observation.snapshot.demandAttoEth = 90n * unit
	observation.snapshot.liquidationPrice = 2n * unit
	observation.snapshot.ownerConservativePrice = 2n * unit
	observation.snapshot.conservativePrice = 2n * unit
	observation.snapshot.ownerPrincipalAttoRep = 200n * unit
	observation.snapshot.ownerAccount.freeAttoRep = 200n * unit
	const result = evaluate(observation)
	expect(result.plan).toMatchObject({ commitment: 90n * unit, minimumTakeoverReward: 105n * unit, ownFunding: 0n })
	expect(result.plan?.netRewardAttoEth).toBeGreaterThan(0n)
})

test('a cure that restores health is screened out of takeovers', () => {
	const observation = securityPoolObservation()
	observation.snapshot.demandAttoEth = 0n
	expect(evaluate(observation).reason).toBe('Cure restores target health without a takeover')
})

function deadlocked() {
	// Two targets each short of backing; the spare covers either deficit but not both.
	const observation = securityPoolObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	position.rep = 100n * unit
	observation.positions.push({ ...position, id: 2n })
	observation.snapshot.totalCommitmentAttoEth = 200n * unit
	observation.snapshot.demandAttoEth = 195n * unit
	return observation
}

test('a healing cure is submitted without a takeover reward only when it opens another position to a profitable takeover', () => {
	const observation = deadlocked()
	const result = evaluate(observation)
	expect(result.reason).toBe('Unpaid cure ready; it opens another position to takeover')
	// Zero consent: the call can cure and nothing else.
	expect(result.plan).toMatchObject({ positionId: 1n, unpaidCure: true, minimumTakeoverReward: 0n, ownFunding: 0n, maximumOwnRep: 0n, maximumOwnerPrincipal: 0n, maximumOwnerCommitment: 0n, commitment: 100n * unit })
	expect(result.plan?.netRewardAttoEth).toBeGreaterThan(0n)
	// Once the cure has spent the spare, the other position is a paid takeover.
	const second = observation.positions[1]
	if (second === undefined) throw new Error('Fixture position missing')
	const cured = securityPoolCureOutcome(observation, observation.positions[0] ?? second)
	observation.snapshot.totalCommitmentAttoEth -= cured.removed
	const paid = securityPoolTakeoverPlan(observation, second, securityPoolSettings(), observation.snapshot.ownerPrincipalAttoRep, true)
	expect(paid.plan).toMatchObject({ positionId: 2n, unpaidCure: false })
	expect(paid.plan?.minimumTakeoverReward).toBe(100n * unit)
	expect(paid.plan?.netRewardAttoEth).toBeGreaterThan(0n)
})

test('no cure is submitted when it opens nothing, when the opened takeover is unprofitable, or without gas for both', () => {
	const alone = deadlocked()
	alone.positions.pop()
	expect(evaluate(alone)).toEqual({ reason: 'Cure restores target health without a takeover' })
	const settings = securityPoolSettings()
	settings.securityPoolPolicy.minimumNetRewardAttoEth = 1_000n * unit
	expect(evaluate(deadlocked(), settings).plan).toBeUndefined()
	const funded = securityPoolSettings()
	funded.securityPoolPolicy.maximumOwnFundingAttoRep = 0n
	expect(evaluate(deadlocked(), funded).plan).toBeUndefined()
	const poor = deadlocked()
	poor.walletAttoEth = securityPoolSettings().strategy.maximumGasCostAttoEth * 3n + securityPoolSettings().securityPoolPolicy.walletReserveAttoEth
	expect(evaluate(poor).plan).toBeUndefined()
	// A position that is already a paid takeover needs no cure elsewhere first.
	const open = deadlocked()
	const second = open.positions[1]
	if (second === undefined) throw new Error('Fixture position missing')
	second.rep = 10n * unit
	second.commitment = 100n * unit
	expect(evaluate(open).plan).toBeUndefined()
})

test('a plan cannot turn from a cure into a takeover, or back, between quote and signature', () => {
	const cure = evaluate(deadlocked()).plan
	if (cure === undefined) throw new Error('Fixture cure missing')
	expect(() => assertSecurityPoolPlanStillAllowed(cure, cure, 'takeover')).not.toThrow()
	expect(() => assertSecurityPoolPlanStillAllowed(cure, { ...cure, unpaidCure: false }, 'takeover')).toThrow('terms changed')
	expect(() => assertSecurityPoolPlanStillAllowed({ ...cure, unpaidCure: false }, cure, 'takeover')).toThrow('terms changed')
})

test('the preliminary cure is unpaid and removes exactly the rounded-up deficit, floored and capped like the index', () => {
	const observation = securityPoolObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	observation.snapshot.demandAttoEth = 0n
	const supported = (((position.rep * 10_000n) / observation.snapshot.securityMultiplierBps) * unit) / observation.snapshot.liquidationPrice
	expect(securityPoolCureOutcome(observation, position)).toMatchObject({ removed: position.commitment - supported, commitment: supported, rep: position.rep, healthy: true })
	observation.snapshot.economics.minimumCommitmentAttoEth = 10n * unit
	expect(securityPoolCureOutcome(observation, position)).toMatchObject({ removed: 10n * unit, commitment: 90n * unit, rep: position.rep, healthy: true })
	observation.snapshot.demandAttoEth = 95n * unit
	expect(securityPoolCureOutcome(observation, position)).toMatchObject({ removed: 0n, commitment: 100n * unit, rep: position.rep, healthy: false })
})

test('the preliminary cure respects minimum commitments without freeing backed REP', () => {
	const observation = securityPoolObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	const principalAttoRep = position.rep
	// A 60 ETH minimum: the cut rounds up to 60 and would leave 40.
	observation.snapshot.economics.minimumCommitmentAttoEth = 60n * unit
	// Even with spare for the whole commitment, a cure cannot free REP that still backs it.
	observation.snapshot.demandAttoEth = 0n
	expect(securityPoolCureOutcome(observation, position)).toMatchObject({ removed: 0n, commitment: 100n * unit, rep: principalAttoRep, healthy: false })
	// Spare of 70 cannot finish the commitment and no smaller cut leaves a whole minimum: nothing is removed.
	observation.snapshot.demandAttoEth = 30n * unit
	expect(securityPoolCureOutcome(observation, position)).toMatchObject({ removed: 0n, commitment: 100n * unit, healthy: false })
	// A deep deficit (10.5 REP back 10 ETH) with a 30 ETH minimum and spare of 95: the uncovered 90 would
	// leave 10, so the cut shrinks to 70 and exactly the minimum remains. The auction can replace
	// this underbacked minimum; any principal not paid as a takeover reward remains credited to the source owner.
	Object.assign(position, { rep: (105n * unit) / 10n })
	observation.snapshot.economics.minimumCommitmentAttoEth = 30n * unit
	observation.snapshot.demandAttoEth = 5n * unit
	expect(securityPoolCureOutcome(observation, position)).toMatchObject({ removed: 70n * unit, commitment: 30n * unit, healthy: false, maximumTakeoverCommitment: 30n * unit })
})

test('takeover prerequisites reject demand or total-capacity changes even below the cure floor', () => {
	const plan = evaluate().plan
	if (plan === undefined) throw new Error('Fixture plan missing')
	for (const action of ['approval', 'principal', 'takeover'] as const) {
		expect(() => assertSecurityPoolPlanStillAllowed(plan, { ...plan, expectedDemand: plan.expectedDemand - 1n }, action)).toThrow('cure capacity changed')
		expect(() => assertSecurityPoolPlanStillAllowed(plan, { ...plan, expectedTotalCommitment: plan.expectedTotalCommitment + 1n }, action)).toThrow('cure capacity changed')
	}
})

test('#1255 active keepers accept queued targets while retiring keepers retain their cohort bounds', () => {
	const observation = securityPoolObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	Object.assign(position, { rep: 105n * unit, batch: 2n, remainingCommitment: 90n * unit })
	Object.assign(observation.snapshot, { demandAttoEth: 90n * unit, liquidationPrice: 2n * unit, ownerConservativePrice: 2n * unit, conservativePrice: 2n * unit, ownerPrincipalAttoRep: 200n * unit })
	observation.snapshot.ownerAccount.freeAttoRep = 200n * unit
	const result = evaluate(observation)
	expect(result.plan).toMatchObject({ commitment: 90n * unit, expectedSourceBatch: 0n })
	const receiver = { id: 2n, owner: observation.snapshot.owner, batch: 0n, rep: 200n * unit, commitment: unit, maxHealthyPrice: 100n * unit, releasedRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, liquidationStarted: 0n, remainingCommitment: 0n, retirementPreview: undefined }
	observation.snapshot.positions = [receiver]
	observation.snapshot.ownerAccount.freeAttoRep = 0n
	observation.snapshot.ownerCommitmentAttoEth = unit
	observation.snapshot.totalCommitmentAttoEth += unit
	observation.snapshot.demandAttoEth += unit
	expect(evaluate(observation).plan).toMatchObject({ commitment: 90n * unit, expectedSourceBatch: 0n })
	receiver.batch = 2n
	expect(evaluate(observation).reason).toContain('cohorts differ')
	position.remainingCommitment = 80n * unit
	expect(evaluate(observation).plan).toMatchObject({ commitment: 90n * unit, expectedSourceBatch: 2n })
	receiver.batch = 0n
	expect(evaluate(observation).plan).toMatchObject({ commitment: 90n * unit, expectedSourceBatch: 2n })
})

test('inherited dust does not reset retirement intent when the cure cannot remove it', () => {
	const observation = securityPoolObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	Object.assign(position, { rep: 1n, commitment: 9n, batch: 2n, remainingCommitment: 8n })
	observation.snapshot.totalCommitmentAttoEth = 9n
	observation.snapshot.demandAttoEth = 1n
	expect(securityPoolCureOutcome(observation, position)).toMatchObject({ removed: 0n, commitment: 9n, batch: 2n, remainingCommitment: 8n })
	observation.snapshot.demandAttoEth = 0n
	expect(securityPoolCureOutcome(observation, position)).toMatchObject({ removed: 0n, commitment: 9n, batch: 2n, remainingCommitment: 8n, healthy: false })
})

test('auction vault commitments consume the same managed commitment budget as direct takeovers', () => {
	const observation = securityPoolObservation()
	observation.managedCommitmentAttoEth = 999n * unit
	expect(evaluate(observation).plan).toBeUndefined()
	observation.managedCommitmentAttoEth = 800n * unit
	expect(evaluate(observation).plan).toMatchObject({ maximumOwnerCommitment: 200n * unit + observation.snapshot.ownerCommitmentAttoEth })
})

test('a pledged takeover reward can justify repair without projecting future fees', () => {
	const observation = securityPoolObservation()
	const settings = securityPoolSettings()
	settings.securityPoolPolicy.takeoverIncomeHorizonSeconds = 0
	expect(evaluate(observation, settings).plan?.minimumTakeoverReward).toBe(99n * unit)
	observation.snapshot.timestamp = 100n
	expect(evaluate(observation, settings).reason).toContain('income horizon')
	settings.securityPoolPolicy.takeoverIncomeHorizonSeconds = 31_536_000
	observation.snapshot.economics.annualFeeBps = 0n
	expect(evaluate(observation, settings).plan).toBeUndefined()
})

test('#1448: a liquidating keeper cannot plan a forbidden principal top-up', () => {
	const observation = securityPoolObservation()
	observation.snapshot.positions = [{ id: 2n, owner: observation.snapshot.owner, batch: 0n, rep: unit, commitment: unit, maxHealthyPrice: 0n, releasedRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, liquidationStarted: 1n, remainingCommitment: 0n, retirementPreview: undefined }]
	observation.snapshot.ownerPrincipalAttoRep = unit
	observation.snapshot.ownerCommitmentAttoEth = unit
	const result = evaluate(observation)
	expect(result.plan).toBeUndefined()
	expect(result.reason).toContain('Receiver position is liquidating')
})

test('a growing auction can fill the previously reviewed commitment without enlarging it before signing', () => {
	const observation = securityPoolObservation()
	observation.snapshot.timestamp = 1900n
	const target = observation.positions[0]
	if (target === undefined) throw new Error('Fixture target missing')
	const first = securityPoolTakeoverPlan(observation, target, securityPoolSettings(), 0n, true).plan
	if (first === undefined) throw new Error('Fixture quote missing')
	observation.snapshot.timestamp = 2000n
	const next = securityPoolTakeoverPlan(observation, target, securityPoolSettings(), 0n, true, first.commitment).plan
	expect(next?.commitment).toBe(first.commitment)
	expect(next?.minimumTakeoverReward).toBeGreaterThanOrEqual(first.minimumTakeoverReward)
})

test('a funded full repair reserves bounded growth while a tight principal cap prevents that reservation', () => {
	const observation = securityPoolObservation()
	const settings = securityPoolSettings()
	const target = observation.positions[0]
	if (target === undefined) throw new Error('Missing takeover target')
	target.liquidationElapsed = 0n
	observation.snapshot.ownerPrincipalAttoRep = 100n * unit
	observation.snapshot.ownerAccount.freeAttoRep = 100n * unit
	const quote = securityPoolTakeoverPlan(observation, target, settings, 100n * unit, true).plan
	expect(quote?.requestedCommitment).toBeGreaterThan(quote?.commitment ?? 0n)
	settings.securityPoolPolicy.maximumPrincipalAttoRep = 100n * unit
	expect(securityPoolTakeoverPlan(observation, target, settings, 100n * unit, true).plan?.requestedCommitment).toBeUndefined()
})
