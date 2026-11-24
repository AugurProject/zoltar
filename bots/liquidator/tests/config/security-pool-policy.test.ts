import { expect, test } from 'bun:test'
import { parseSettings, serializedSettings } from '../../src/config/settings.ts'
import { parseSecurityPoolPolicy, parseSecurityPoolSelections } from '../../src/config/security-pool-policy.ts'
import example from '../../config/operator.example.json'
import { securityPoolAddress } from '../support/security-pool-observation.ts'

test('security pool execution starts disabled with zero exposure caps, no selections and no approvals', () => {
	const settings = parseSettings(example)
	expect(settings.selectedSecurityPools).toEqual([])
	expect(settings.approvedUniverses).toEqual([])
	expect(settings.securityPoolPolicy.allowFundedTakeovers).toBe(false)
	expect(settings.securityPoolPolicy.takeoverIncomeHorizonSeconds).toBe(0)
	expect(settings.securityPoolPolicy.maximumPrincipalAttoRep).toBe(0n)
	expect(settings.runtime.execute).toBe(false)
	expect(settings.paused).toBe(true)
	expect(parseSettings(serializedSettings(settings))).toEqual(settings)
})

test('explicit security pool selections are bounded, unique and independent of universe approval', () => {
	const selection = { address: securityPoolAddress, universeId: '0' }
	expect(parseSecurityPoolSelections([selection])).toEqual([{ address: securityPoolAddress, universeId: 0n }])
	expect(() => parseSecurityPoolSelections([selection, selection])).toThrow('Duplicate')
	expect(() => parseSecurityPoolSelections([{ ...selection, universeId: (2n ** 248n).toString() }])).toThrow('uint248')
	expect(() => parseSecurityPoolPolicy({ allowFundedTakeovers: true })).toThrow('positive')
	expect(() => parseSecurityPoolPolicy({ maximumPositionsPerScan: 257 })).toThrow()
	expect(() => parseSecurityPoolPolicy({ maximumPrincipalRep: '2', maximumTotalPrincipalRep: '1' })).toThrow('total')
})

test('settings have no automatic report sponsorship and reject its former fields', () => {
	expect(Object.keys(serializedSettings(parseSettings(example)).securityPoolPolicy)).not.toContain('maximumReportFundingEth')
	for (const field of ['maximumReportFundingEth', 'reportOperationGasLimit', 'reportOperationsGasLimit']) {
		expect(() => parseSettings({ ...example, securityPoolPolicy: { ...example.securityPoolPolicy, [field]: field === 'maximumReportFundingEth' ? '0.25' : 3_000_000 } })).toThrow(`unsupported field ${field}`)
	}
})

test('repair income horizons are bounded and survive settings round trips', () => {
	const settings = parseSettings({ ...example, securityPoolPolicy: { ...example.securityPoolPolicy, takeoverIncomeHorizonSeconds: 86400 } })
	expect(parseSettings(serializedSettings(settings)).securityPoolPolicy.takeoverIncomeHorizonSeconds).toBe(86400)
	expect(() => parseSecurityPoolPolicy({ takeoverIncomeHorizonSeconds: -1 })).toThrow()
	expect(() => parseSecurityPoolPolicy({ takeoverIncomeHorizonSeconds: 31_536_001 })).toThrow()
})

test('#1493: the protocol default health target is configurable', () => {
	expect(parseSecurityPoolPolicy({ targetHealthFactorBps: 10_000 }).targetHealthFactorBps).toBe(10_000n)
	expect(() => parseSecurityPoolPolicy({ targetHealthFactorBps: 9_999 })).toThrow()
})
