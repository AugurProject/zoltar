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
	expect(plan).toMatchObject({ commitment: 100n * unit, minimumAward: 99n * unit, ownFunding: (585n * unit) / 10n, maximumOwnRep: (585n * unit) / 10n, maximumOwnerPrincipal: 1000n * unit, expectedSourceBatch: 0n })
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

test('managed scopes, future award growth, principal and commitment caps, wallet gas are enforced', () => {
	const settings = portfolioSettings()
	settings.portfolioPolicy.maximumPrincipalAttoRep = 150n * unit
	expect(evaluate(portfolioObservation(), settings).reason).toContain('principal exposure')
	settings.portfolioPolicy.maximumPrincipalAttoRep = 1000n * unit
	expect(evaluate(portfolioObservation(), settings, 1900n * unit).reason).toContain('principal exposure')
	settings.portfolioPolicy.maximumCommitmentAttoEth = 99n * unit
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
	expect(result.plan).toMatchObject({ commitment: 90n * unit, minimumAward: 105n * unit, ownFunding: 0n })
	expect(result.plan?.netRewardAttoEth).toBeGreaterThan(0n)
})

test('a cure that restores health is screened out of takeovers', () => {
	const observation = portfolioObservation()
	observation.snapshot.demandAttoEth = 0n
	expect(evaluate(observation).reason).toBe('Cure restores target health without a takeover')
})

test('takeover prerequisites reject demand or total-capacity changes even below the cure floor', () => {
	const plan = evaluate().plan
	if (plan === undefined) throw new Error('Fixture plan missing')
	for (const action of ['approval', 'principal', 'takeover'] as const) {
		expect(() => assertPortfolioPlanStillAllowed(plan, { ...plan, expectedDemand: plan.expectedDemand - 1n }, action)).toThrow('cure capacity changed')
		expect(() => assertPortfolioPlanStillAllowed(plan, { ...plan, expectedTotalCommitment: plan.expectedTotalCommitment + 1n }, action)).toThrow('cure capacity changed')
	}
})

test('atomic cure crossing the retained commitment joins the active receiver cohort', () => {
	const observation = portfolioObservation()
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
	expect(portfolioCureOutcome(observation, position)).toMatchObject({ removed: 9n, commitment: 0n, batch: 0n, remainingCommitment: 0n, healthy: true })
})
