import { expect, test } from 'bun:test'
import { portfolioReportTakeoverPlan } from '../../src/core/portfolio-report-strategy.ts'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'

function fixture() {
	const observation = portfolioObservation()
	const settings = portfolioSettings()
	observation.snapshot.priceValid = false
	settings.portfolioPolicy.maximumReportFundingAttoEth = unit / 100n
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Missing target')
	return { observation, settings, position, run: (market = true) => portfolioReportTakeoverPlan(observation, position, settings, observation.snapshot.ownerPrincipalAttoRep, market) }
}

test('stale adverse prices can be renewed for a bounded takeover, without mutating observed freshness', () => {
	const value = fixture()
	expect(value.run().plan).toBeDefined()
	expect(value.observation.snapshot.priceValid).toBe(false)
})

test('sponsorship requires an explicit loss budget, prior adverse observation and independent price agreement', () => {
	const value = fixture()
	expect(value.run(false).plan).toBeUndefined()
	value.settings.portfolioPolicy.maximumReportFundingAttoEth = 0n
	expect(value.run().plan).toBeUndefined()
	value.settings.portfolioPolicy.maximumReportFundingAttoEth = unit / 100n
	value.position.liquidationStarted = 0n
	expect(value.run().plan).toBeUndefined()
	value.position.liquidationStarted = 1n
	value.observation.snapshot.acceptedPrice = 0n
	expect(value.run().plan).toBeUndefined()
})

test('the entire report loss budget and additional transaction gas must fit the profit floor', () => {
	const value = fixture()
	value.settings.portfolioPolicy.maximumReportFundingAttoEth = 100n * unit
	expect(value.run().reason).toContain('profit')
})

test('report batches grow to their gas budget and reserve combined funding and principal', () => {
	const value = fixture()
	value.observation.positions.push({ ...value.position, id: 2n })
	value.observation.snapshot.totalCommitmentAttoEth = 200n * unit
	value.observation.snapshot.demandAttoEth = 200n * unit
	value.settings.portfolioPolicy.reportOperationsGasLimit = 6_200_000
	const batch = value.run()
	expect(batch.plans).toHaveLength(2)
	expect(batch.plan?.ownFunding).toBe(117n * unit)
	expect(value.observation.snapshot.ownerPrincipalAttoRep).toBe(0n)
	value.settings.portfolioPolicy.reportOperationsGasLimit = 3_100_000
	expect(value.run().plans).toHaveLength(1)
	value.settings.portfolioPolicy.reportOperationsGasLimit = 6_200_000
	value.settings.portfolioPolicy.maximumOwnFundingAttoRep = 100n * unit
	expect(value.run().plans).toHaveLength(1)
})

test('report batches do not hide sibling-vault exposure or repeat one target', () => {
	const value = fixture()
	value.observation.positions.push({ ...value.position }, { ...value.position, id: 2n })
	value.observation.snapshot.totalCommitmentAttoEth = 200n * unit
	value.observation.snapshot.demandAttoEth = 200n * unit
	value.settings.portfolioPolicy.reportOperationsGasLimit = 9_300_000
	expect(value.run().plans).toHaveLength(2)
	value.observation.managedPrincipalAttoRep = 800n * unit
	expect(value.run().plans).toHaveLength(1)
})

test.each(['funding', 'principal'])('skips a target that exceeds remaining %s and keeps smaller later takeovers', budget => {
	const value = fixture()
	value.observation.positions.push({ ...value.position, id: 2n, rep: (1188n * unit) / 10n, commitment: 120n * unit }, { ...value.position, id: 3n, rep: (495n * unit) / 10n, commitment: 50n * unit })
	value.observation.snapshot.totalCommitmentAttoEth = 270n * unit
	value.observation.snapshot.demandAttoEth = 270n * unit
	value.settings.portfolioPolicy.reportOperationsGasLimit = 9_300_000
	if (budget === 'funding') value.settings.portfolioPolicy.maximumOwnFundingAttoRep = 100n * unit
	else value.settings.portfolioPolicy.maximumPrincipalAttoRep = 300n * unit
	expect(value.run().plans?.map(item => item.target)).toEqual([1n, 3n])
	expect(value.run().plan?.ownFunding).toBe((8775n * unit) / 100n)
})
