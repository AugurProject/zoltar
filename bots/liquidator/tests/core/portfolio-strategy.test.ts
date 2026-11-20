import { expect, test } from 'bun:test'
import { portfolioCureOutcome } from '../../src/core/portfolio-cure-state.ts'
import { portfolioTakeoverPlan } from '../../src/core/portfolio-strategy.ts'
import { assertPortfolioPlanStillAllowed } from '../../src/execution/portfolio-executor.ts'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'

function evaluate(observation = portfolioObservation(), settings = portfolioSettings(), totalPrincipal = observation.snapshot.ownerPrincipalAttoRep, marketAllowed = true) {
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	return portfolioTakeoverPlan(observation, position, settings, totalPrincipal, marketAllowed)
}

test('funded takeover bounds the entire transferred obligation, owner collateral without upfront ETH funding', () => {
	const plan = evaluate().plan
	expect(plan).toMatchObject({ commitment: 5_714_285_714_285_714_286n, minimumAward: 0n, ownFunding: 9_000_000_000_000_000_002n, maximumOwnRep: 9_000_000_000_000_000_002n, maximumOwnerPrincipal: 1000n * unit, expectedSourceBatch: 0n })
	expect(plan?.netRewardAttoEth).toBeGreaterThan(0n)
})

test('an independently accounted auction vault controlled by the keeper is not an external profit opportunity', () => {
	const observation = portfolioObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture target missing')
	Object.assign(position, { controllingOwner: observation.snapshot.owner })
	expect(evaluate(observation).plan).toBeUndefined()
})

test('unapproved, deselected, stale, forked and independent-price failures cannot produce actions', () => {
	for (const mutation of [
		(value: ReturnType<typeof portfolioObservation>) => {
			value.approvedUniverse = false
		},
		(value: ReturnType<typeof portfolioObservation>) => {
			value.selected = false
		},
		(value: ReturnType<typeof portfolioObservation>) => {
			value.snapshot.priceValid = false
		},
		(value: ReturnType<typeof portfolioObservation>) => {
			value.snapshot.timestamp = value.snapshot.priceValidUntil
		},
		(value: ReturnType<typeof portfolioObservation>) => {
			value.snapshot.forkTime = 1n
		},
		(value: ReturnType<typeof portfolioObservation>) => {
			value.snapshot.importing = true
		},
	]) {
		const observation = portfolioObservation()
		mutation(observation)
		expect(evaluate(observation).plan).toBeUndefined()
	}
	expect(evaluate(portfolioObservation(), portfolioSettings(), 0n, false).plan).toBeUndefined()
})

test('receiver cohort and exact health consent are required; dust spare capacity cannot block takeover', () => {
	const observation = portfolioObservation()
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
	const settings = portfolioSettings()
	settings.portfolioPolicy.maximumPrincipalAttoRep = 8n * unit
	expect(evaluate(portfolioObservation(), settings).reason).toContain('principal exposure')
	settings.portfolioPolicy.maximumPrincipalAttoRep = 1000n * unit
	expect(evaluate(portfolioObservation(), settings, 1995n * unit).reason).toContain('principal exposure')
	settings.portfolioPolicy.maximumCommitmentAttoEth = 5n * unit
	expect(evaluate(portfolioObservation(), settings).reason).toContain('commitment limit')
	settings.portfolioPolicy.maximumCommitmentAttoEth = 1000n * unit
	settings.portfolioPolicy.maximumOwnFundingAttoRep = unit
	expect(evaluate(portfolioObservation(), settings).reason).toContain('Own REP funding')
	settings.portfolioPolicy.maximumOwnFundingAttoRep = 1000n * unit
	const observation = portfolioObservation()
	observation.walletAttoEth = 0n
	expect(evaluate(observation, settings).reason).toContain('gas reserve')
	observation.walletAttoEth = 10n * unit
	observation.walletRep = 0n
	expect(evaluate(observation, settings).reason).toContain('Wallet REP')
})

test('each prerequisite is followed by fresh funding, cohort, exposure and award revalidation', () => {
	const plan = evaluate().plan
	if (plan === undefined) throw new Error('Fixture plan missing')
	expect(() => assertPortfolioPlanStillAllowed(plan, { ...plan, ownFunding: plan.ownFunding + 1n }, 'principal')).toThrow('funding requirement')
	expect(() => assertPortfolioPlanStillAllowed(plan, { ...plan, expectedSourceBatch: 2n }, 'approval')).toThrow('cohort')
	expect(() => assertPortfolioPlanStillAllowed(plan, { ...plan, maximumOwnerPrincipal: plan.maximumOwnerPrincipal - 1n }, 'principal')).toThrow('exposure')
	const funded = { ...plan, ownFunding: 0n }
	expect(() => assertPortfolioPlanStillAllowed(funded, { ...funded, minimumAward: funded.minimumAward - 1n }, 'takeover')).toThrow('terms')
	expect(() => assertPortfolioPlanStillAllowed(funded, { ...funded, ownFunding: 1n }, 'takeover')).toThrow('terms')
	expect(() => assertPortfolioPlanStillAllowed(funded, funded, 'takeover')).not.toThrow()
})

test('atomic takeover can remove unpaid spare commitment and acquire the still unhealthy residual', () => {
	const observation = portfolioObservation()
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
	expect(result.plan).toMatchObject({ commitment: 40n * unit, minimumAward: 0n, ownFunding: 0n })
	expect(result.plan?.netRewardAttoEth).toBeGreaterThan(0n)
})

test('a cure that restores health is screened out of takeovers', () => {
	const observation = portfolioObservation()
	observation.snapshot.demandAttoEth = 0n
	expect(evaluate(observation).reason).toBe('Cure restores target health without a takeover')
})

function deadlocked() {
	// Two targets each short of backing; the spare covers either deficit but not both.
	const observation = portfolioObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	position.rep = 100n * unit
	observation.positions.push({ ...position, id: 2n })
	observation.snapshot.totalCommitmentAttoEth = 200n * unit
	observation.snapshot.demandAttoEth = 195n * unit
	return observation
}

test('a healing cure is submitted without an award only when it opens another position to a profitable takeover', () => {
	const observation = deadlocked()
	const result = evaluate(observation)
	expect(result.reason).toBe('Unpaid cure ready; it opens another position to takeover')
	// Zero consent: the call can cure and nothing else.
	expect(result.plan).toMatchObject({ positionId: 1n, unpaidCure: true, minimumAward: 0n, ownFunding: 0n, maximumOwnRep: 0n, maximumOwnerPrincipal: 0n, maximumOwnerCommitment: 0n, commitment: 100n * unit })
	expect(result.plan?.netRewardAttoEth).toBeGreaterThan(0n)
	// Once the cure has spent the spare, the other position is a paid takeover.
	const second = observation.positions[1]
	if (second === undefined) throw new Error('Fixture position missing')
	const cured = portfolioCureOutcome(observation, observation.positions[0] ?? second)
	observation.snapshot.totalCommitmentAttoEth -= cured.removed
	const paid = portfolioTakeoverPlan(observation, second, portfolioSettings(), observation.snapshot.ownerPrincipalAttoRep, true)
	expect(paid.plan).toMatchObject({ positionId: 2n, unpaidCure: false })
	expect(paid.plan?.minimumAward).toBe(0n)
	expect(paid.plan?.netRewardAttoEth).toBeGreaterThan(0n)
})

test('no cure is submitted when it opens nothing, when the opened takeover is unprofitable, or without gas for both', () => {
	const alone = deadlocked()
	alone.positions.pop()
	expect(evaluate(alone)).toEqual({ reason: 'Cure restores target health without a takeover' })
	const settings = portfolioSettings()
	settings.portfolioPolicy.minimumNetRewardAttoEth = 1_000n * unit
	expect(evaluate(deadlocked(), settings).plan).toBeUndefined()
	const funded = portfolioSettings()
	funded.portfolioPolicy.maximumOwnFundingAttoRep = 0n
	expect(evaluate(deadlocked(), funded).plan).toBeUndefined()
	const poor = deadlocked()
	poor.walletAttoEth = portfolioSettings().strategy.maximumGasCostAttoEth * 3n + portfolioSettings().portfolioPolicy.walletReserveAttoEth
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
	expect(() => assertPortfolioPlanStillAllowed(cure, cure, 'takeover')).not.toThrow()
	expect(() => assertPortfolioPlanStillAllowed(cure, { ...cure, unpaidCure: false }, 'takeover')).toThrow('terms changed')
	expect(() => assertPortfolioPlanStillAllowed({ ...cure, unpaidCure: false }, cure, 'takeover')).toThrow('terms changed')
})

test('the preliminary cure is unpaid and removes exactly the rounded-up deficit, floored and capped like the index', () => {
	const observation = portfolioObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	observation.snapshot.demandAttoEth = 0n
	const supported = (((position.rep * 10_000n) / observation.snapshot.securityMultiplierBps) * unit) / observation.snapshot.liquidationPrice
	expect(portfolioCureOutcome(observation, position)).toMatchObject({ removed: position.commitment - supported, commitment: supported, rep: position.rep, healthy: true })
	observation.snapshot.economics.minimumCommitmentAttoEth = 10n * unit
	expect(portfolioCureOutcome(observation, position)).toMatchObject({ removed: 10n * unit, commitment: 90n * unit, rep: position.rep, healthy: true })
	observation.snapshot.demandAttoEth = 95n * unit
	expect(portfolioCureOutcome(observation, position)).toMatchObject({ removed: 0n, commitment: 100n * unit, rep: position.rep, healthy: false })
})

test('the preliminary cure respects minimum commitments without freeing backed REP', () => {
	const observation = portfolioObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	const principalAttoRep = position.rep
	// A 60 ETH minimum: the cut rounds up to 60 and would leave 40.
	observation.snapshot.economics.minimumCommitmentAttoEth = 60n * unit
	// Even with spare for the whole commitment, a cure cannot free REP that still backs it.
	observation.snapshot.demandAttoEth = 0n
	expect(portfolioCureOutcome(observation, position)).toMatchObject({ removed: 0n, commitment: 100n * unit, rep: principalAttoRep, healthy: false })
	// Spare of 70 cannot finish the commitment and no smaller cut leaves a whole minimum: nothing is removed.
	observation.snapshot.demandAttoEth = 30n * unit
	expect(portfolioCureOutcome(observation, position)).toMatchObject({ removed: 0n, commitment: 100n * unit, healthy: false })
	// A deep deficit (10.5 REP back 10 ETH) with a 30 ETH minimum and spare of 95: the uncovered 90 would
	// leave 10, so the cut shrinks to 70 and exactly the minimum remains, still open to a takeover.
	Object.assign(position, { rep: (105n * unit) / 10n })
	observation.snapshot.economics.minimumCommitmentAttoEth = 30n * unit
	observation.snapshot.demandAttoEth = 5n * unit
	expect(portfolioCureOutcome(observation, position)).toMatchObject({ removed: 70n * unit, commitment: 30n * unit, healthy: false })
})

test('takeover prerequisites reject demand or total-capacity changes even below the cure floor', () => {
	const plan = evaluate().plan
	if (plan === undefined) throw new Error('Fixture plan missing')
	for (const action of ['approval', 'principal', 'takeover'] as const) {
		expect(() => assertPortfolioPlanStillAllowed(plan, { ...plan, expectedDemand: plan.expectedDemand - 1n }, action)).toThrow('cure capacity changed')
		expect(() => assertPortfolioPlanStillAllowed(plan, { ...plan, expectedTotalCommitment: plan.expectedTotalCommitment + 1n }, action)).toThrow('cure capacity changed')
	}
})

test('#1255 active keepers accept queued targets while retiring keepers retain their cohort bounds', () => {
	const observation = portfolioObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	Object.assign(position, { rep: 105n * unit, batch: 2n, remainingCommitment: 90n * unit })
	Object.assign(observation.snapshot, { demandAttoEth: 90n * unit, liquidationPrice: 2n * unit, ownerConservativePrice: 2n * unit, conservativePrice: 2n * unit, ownerPrincipalAttoRep: 200n * unit })
	observation.snapshot.ownerAccount.freeAttoRep = 200n * unit
	const result = evaluate(observation)
	expect(result.plan).toMatchObject({ commitment: 40n * unit, expectedSourceBatch: 0n })
	const receiver = { id: 2n, owner: observation.snapshot.owner, batch: 0n, rep: 200n * unit, commitment: unit, maxHealthyPrice: 100n * unit, releasedRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, liquidationStarted: 0n, remainingCommitment: 0n, retirementPreview: undefined }
	observation.snapshot.positions = [receiver]
	observation.snapshot.ownerAccount.freeAttoRep = 0n
	observation.snapshot.ownerCommitmentAttoEth = unit
	observation.snapshot.totalCommitmentAttoEth += unit
	observation.snapshot.demandAttoEth += unit
	expect(evaluate(observation).plan).toMatchObject({ commitment: 40n * unit, expectedSourceBatch: 0n })
	receiver.batch = 2n
	expect(evaluate(observation).reason).toContain('cohorts differ')
	position.remainingCommitment = 80n * unit
	expect(evaluate(observation).plan).toMatchObject({ commitment: 40n * unit, expectedSourceBatch: 2n })
	receiver.batch = 0n
	expect(evaluate(observation).plan).toMatchObject({ commitment: 40n * unit, expectedSourceBatch: 2n })
})

test('inherited dust does not reset retirement intent when the cure cannot remove it', () => {
	const observation = portfolioObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	Object.assign(position, { rep: 1n, commitment: 9n, batch: 2n, remainingCommitment: 8n })
	observation.snapshot.totalCommitmentAttoEth = 9n
	observation.snapshot.demandAttoEth = 1n
	expect(portfolioCureOutcome(observation, position)).toMatchObject({ removed: 0n, commitment: 9n, batch: 2n, remainingCommitment: 8n })
	observation.snapshot.demandAttoEth = 0n
	expect(portfolioCureOutcome(observation, position)).toMatchObject({ removed: 0n, commitment: 9n, batch: 2n, remainingCommitment: 8n, healthy: false })
})

test('auction vault commitments consume the same managed commitment budget as direct takeovers', () => {
	const observation = portfolioObservation()
	observation.managedCommitmentAttoEth = 999n * unit
	expect(evaluate(observation).plan).toBeUndefined()
	observation.managedCommitmentAttoEth = 800n * unit
	expect(evaluate(observation).plan).toMatchObject({ maximumOwnerCommitment: 200n * unit + observation.snapshot.ownerCommitmentAttoEth })
})

test('repair automation requires an explicit income horizon and never counts source REP as profit', () => {
	const observation = portfolioObservation()
	const settings = portfolioSettings()
	settings.portfolioPolicy.takeoverIncomeHorizonSeconds = 0
	expect(evaluate(observation, settings).reason).toContain('income horizon')
	settings.portfolioPolicy.takeoverIncomeHorizonSeconds = 31_536_000
	observation.snapshot.economics.annualFeeBps = 0n
	expect(evaluate(observation, settings).plan).toBeUndefined()
})

test('#1448: a liquidating keeper cannot plan a forbidden principal top-up', () => {
	const observation = portfolioObservation()
	observation.snapshot.positions = [{ id: 2n, owner: observation.snapshot.owner, batch: 0n, rep: unit, commitment: unit, maxHealthyPrice: 0n, releasedRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, liquidationStarted: 1n, remainingCommitment: 0n, retirementPreview: undefined }]
	observation.snapshot.ownerPrincipalAttoRep = unit
	observation.snapshot.ownerCommitmentAttoEth = unit
	const result = evaluate(observation)
	expect(result.plan).toBeUndefined()
	expect(result.reason).toContain('Receiver position is liquidating')
})
