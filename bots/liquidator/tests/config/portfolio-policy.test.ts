import { expect, test } from 'bun:test'
import { parseSettings, serializedSettings } from '../../src/config/settings.ts'
import { parsePortfolioPolicy, parsePortfolioSelections } from '../../src/config/portfolio-policy.ts'
import example from '../../config/operator.example.json'
import { portfolioAddress } from '../support/portfolio-observation.ts'

test('portfolio execution starts disabled with zero exposure caps, no selections and no approvals', () => {
	const settings = parseSettings(example)
	expect(settings.selectedPortfolios).toEqual([])
	expect(settings.approvedUniverses).toEqual([])
	expect(settings.portfolioPolicy.allowFundedTakeovers).toBe(false)
	expect(settings.portfolioPolicy.maximumPrincipalAttoRep).toBe(0n)
	expect(settings.runtime.execute).toBe(false)
	expect(settings.paused).toBe(true)
	expect(parseSettings(serializedSettings(settings))).toEqual(settings)
})

test('explicit portfolio selections are bounded, unique and independent of universe approval', () => {
	const selection = { address: portfolioAddress, universeId: '0' }
	expect(parsePortfolioSelections([selection])).toEqual([{ address: portfolioAddress, universeId: 0n }])
	expect(() => parsePortfolioSelections([selection, selection])).toThrow('Duplicate')
	expect(() => parsePortfolioSelections([{ ...selection, universeId: (2n ** 248n).toString() }])).toThrow('uint248')
	expect(() => parsePortfolioPolicy({ allowFundedTakeovers: true })).toThrow('positive')
	expect(() => parsePortfolioPolicy({ maximumPositionsPerScan: 257 })).toThrow()
	expect(() => parsePortfolioPolicy({ maximumPrincipalRep: '2', maximumTotalPrincipalRep: '1' })).toThrow('total')
})
