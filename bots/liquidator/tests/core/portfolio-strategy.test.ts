import { expect, test } from 'bun:test'
import { portfolioTakeoverPlan } from '../../src/core/portfolio-strategy.ts'
import { assertPortfolioPlanStillAllowed } from '../../src/execution/portfolio-executor.ts'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'

function evaluate(observation = portfolioObservation(), settings = portfolioSettings(), totalPrincipal = observation.snapshot.ownerPrincipalAttoRep, marketAllowed = true) {
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	return portfolioTakeoverPlan(observation, position, settings, totalPrincipal, marketAllowed)
}

test('funded takeover bounds the entire transferred obligation, owner collateral and reserve', () => {
	const plan = evaluate().plan
	expect(plan).toMatchObject({ commitment: 100n * unit, minimumAward: 99n * unit, ownFunding: (585n * unit) / 10n, reserveFunding: unit / 10n, maximumOwnRep: (585n * unit) / 10n, maximumOwnerPrincipal: 1000n * unit, expectedSourceBatch: 0n })
	expect(plan?.netRewardAttoEth).toBeGreaterThan(0n)
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

test('receiver cohort and exact health consent are required; cure-changing targets are excluded', () => {
	const observation = portfolioObservation()
	observation.snapshot.ownerAccount.targetHealthFactorBps = 10_000n
	expect(evaluate(observation).reason).toContain('health target')
	observation.snapshot.ownerAccount.targetHealthFactorBps = 15_000n
	observation.snapshot.positions = [{ id: 2n, owner: observation.snapshot.owner, batch: 2n, rep: unit, commitment: unit, maxHealthyPrice: unit, releasedRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, executionReserveAttoEth: 0n, liquidationStarted: 0n, remainingCommitment: 0n, retirementPreview: undefined }]
	expect(evaluate(observation).reason).toContain('cohorts differ')
	observation.snapshot.positions = []
	observation.snapshot.demandAttoEth--
	expect(evaluate(observation).reason).toContain('cured')
})

test('managed scopes, future award growth, principal and commitment caps, wallet gas and reserve funding are enforced', () => {
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
	settings.portfolioPolicy.maximumReserveFundingAttoEth = 0n
	expect(evaluate(portfolioObservation(), settings).reason).toContain('reserve funding')
	settings.portfolioPolicy.maximumReserveFundingAttoEth = unit
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
	expect(() => assertPortfolioPlanStillAllowed(plan, { ...plan, maximumOwnerPrincipal: plan.maximumOwnerPrincipal - 1n }, 'reserve')).toThrow('exposure')
	const funded = { ...plan, ownFunding: 0n, reserveFunding: 0n }
	expect(() => assertPortfolioPlanStillAllowed(funded, { ...funded, minimumAward: funded.minimumAward - 1n }, 'takeover')).toThrow('terms')
	expect(() => assertPortfolioPlanStillAllowed(funded, { ...funded, reserveFunding: 1n }, 'takeover')).toThrow('terms')
	expect(() => assertPortfolioPlanStillAllowed(funded, funded, 'takeover')).not.toThrow()
})
