import { describe, expect, test } from 'bun:test'
import { parseRunCommand } from '../../src/cli/run.ts'

describe('retirement CLI', () => {
	test('parses a profile-confirmed drain request and bounded policies', () => {
		expect(parseRunCommand(['--drain', '0x0000000000000000000000000000000000000001', '--exit-unmatched-shares=250', '--migrate-existing-claims', '--exit-after-completion', '--confirm', 'DRAIN profile:test TO 0x1'])).toMatchObject({
			exitAfterCompletion: true,
			exitUnmatchedShares: true,
			kind: 'request-drain',
			maximumExitLossBps: 250,
			migrateExistingClaims: true,
		})
	})

	test('accepts the space-separated unmatched-share loss and rejects arguments it would otherwise ignore', () => {
		const recipient = '0x0000000000000000000000000000000000000001'
		expect(parseRunCommand(['--drain', recipient, '--exit-unmatched-shares', '150', '--exit-after-completion', '--confirm', 'x'])).toMatchObject({ exitAfterCompletion: true, exitUnmatchedShares: true, maximumExitLossBps: 150 })
		expect(parseRunCommand(['--drain', recipient, '--confirm', 'x'])).toMatchObject({ exitAfterCompletion: false, exitUnmatchedShares: false, maximumExitLossBps: 0, migrateExistingClaims: false })
		expect(() => parseRunCommand(['--drain', recipient, '--exit-unmatched-share=150', '--confirm', 'x'])).toThrow('Unsupported or repeated drain argument')
		expect(() => parseRunCommand(['--drain', recipient, '--exit-after-completion', '--exit-after-completion', '--confirm', 'x'])).toThrow('Unsupported or repeated drain argument')
		expect(() => parseRunCommand(['--drain', recipient, '--confirm', 'x', '--exit-unmatched-shares'])).toThrow('requires a maximum loss')
		expect(() => parseRunCommand(['--drain', recipient, '--exit-unmatched-shares=1e2', '--confirm', 'x'])).toThrow('10000')
	})

	test('rejects missing confirmation and invalid maximum loss', () => {
		expect(() => parseRunCommand(['--drain', '0x1'])).toThrow('--confirm')
		expect(() => parseRunCommand(['--drain', '0x1', '--exit-unmatched-shares=10001', '--confirm', 'x'])).toThrow('10000')
		expect(() => parseRunCommand(['--drain', '0x0000000000000000000000000000000000000000', '--confirm', 'x'])).toThrow('zero address')
	})

	test('supports status, cancellation, residual acceptance, and verified V3 registration', () => {
		expect(parseRunCommand(['--retirement-status'])).toEqual({ kind: 'retirement-status' })
		expect(parseRunCommand(['--cancel-drain', '--confirm', 'CANCEL DRAIN'])).toEqual({ confirmation: 'CANCEL DRAIN', kind: 'cancel-drain' })
		expect(parseRunCommand(['--accept-residuals', 'profile:next', '--reason', 'Reviewed residual assets and accepted replacement.', '--confirm', 'ACCEPT RESIDUALS FOR profile:next'])).toEqual({
			confirmation: 'ACCEPT RESIDUALS FOR profile:next',
			kind: 'accept-residuals',
			reason: 'Reviewed residual assets and accepted replacement.',
			targetProfileId: 'profile:next',
		})
		expect(parseRunCommand(['--register-v3-position', '{}', '--confirm', 'REGISTER V3 profile:test'])).toEqual({ confirmation: 'REGISTER V3 profile:test', json: '{}', kind: 'register-v3-position' })
	})
})
