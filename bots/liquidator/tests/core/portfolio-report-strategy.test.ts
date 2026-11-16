import { expect, test } from 'bun:test'
import { portfolioReportTakeoverPlan } from '../../src/core/portfolio-report-strategy.ts'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'

function fixture() {
	const observation = portfolioObservation()
	const settings = portfolioSettings()
	observation.snapshot.priceValid = false
	observation.snapshot.timestamp = observation.snapshot.priceValidUntil + 3600n
	settings.portfolioPolicy.maximumReportFundingAttoEth = unit / 100n
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Missing target')
	return { observation, settings, position, run: (market = true) => portfolioReportTakeoverPlan(observation, position, settings, observation.snapshot.ownerPrincipalAttoRep, market) }
}

test('#1253 a stale adverse report cannot promise an award accrued while owners could not cure', () => {
	const value = fixture()
	const before = structuredClone(value.observation)
	expect(value.run()).toEqual({ reason: 'Fresh report restarts takeover award clock' })
	expect(value.observation).toEqual(before)
})

test('#1253 expiry at the exact freshness boundary resets the award, regardless of target count or budget', () => {
	const value = fixture()
	value.observation.snapshot.timestamp = value.observation.snapshot.priceValidUntil
	value.observation.positions.push({ ...value.position, id: 2n })
	value.settings.portfolioPolicy.maximumReportFundingAttoEth = 100n * unit
	value.settings.portfolioPolicy.reportOperationsGasLimit = 9_300_000
	expect(value.run().plan).toBeUndefined()
	expect(value.run(false).plan).toBeUndefined()
})

test('a fresh price uses direct takeover and sponsorship still requires an explicit loss budget and accepted observation', () => {
	const value = fixture()
	value.observation.snapshot.priceValid = true
	value.observation.snapshot.timestamp = value.observation.snapshot.priceValidUntil - 1n
	expect(value.run().reason).toBe('Use the existing fresh price')
	value.settings.portfolioPolicy.maximumReportFundingAttoEth = 0n
	expect(value.run().plan).toBeUndefined()
	value.settings.portfolioPolicy.maximumReportFundingAttoEth = unit / 100n
	value.observation.snapshot.acceptedPrice = 0n
	expect(value.run().plan).toBeUndefined()
})
