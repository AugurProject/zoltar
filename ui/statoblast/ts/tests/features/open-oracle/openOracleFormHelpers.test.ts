/// <reference types="bun-types" />

import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { getDefaultOpenOracleCreateFormState } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/formDefaults.js'
import {
	formatOpenOraclePriceInput,
	formatOpenOracleSecondsInputHint,
	formatOpenOracleTimingDuration,
	getOpenOracleCreateEthSent,
	getOpenOracleCreateValidation,
	getOpenOracleImpliedPrice,
	getOpenOracleReportProgress,
	getOpenOracleReportProgressLabel,
	getOpenOracleReportProgressTone,
	parseOpenOracleCreateFormSubmission,
} from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracle.js'
import { getCreatedOpenOracleReportId } from '@zoltar/ui-statoblast-shared/protocol/openOracle.js'
import { describe, expect, test } from 'bun:test'

const TOKEN1_ADDRESS = '0x2000000000000000000000000000000000000000'
const TOKEN2_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

function createValidForm(overrides: Partial<ReturnType<typeof getDefaultOpenOracleCreateFormState>> = {}) {
	return {
		...getDefaultOpenOracleCreateFormState(),
		disputeDelay: '10',
		exactToken1Report: '1',
		initialToken2Amount: '3',
		settlementTime: '60',
		settlerRewardEthAmount: '0.01',
		token1Address: TOKEN1_ADDRESS,
		token2Address: TOKEN2_ADDRESS,
		...overrides,
	}
}

function createProgressReport(overrides: Partial<Parameters<typeof getOpenOracleReportProgress>[0]> = {}) {
	return {
		currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
		disputeDelay: 10n,
		disputeOccurred: false,
		isDistributed: false,
		reportTimestamp: 100n,
		settlementTime: 60n,
		timeType: true,
		...overrides,
	}
}

describe('Open Oracle create form helpers', () => {
	test('accepts a decimal escalation multiplier and stores it scaled by 100', () => {
		expect(getDefaultOpenOracleCreateFormState().multiplier).toBe('1')
		// Typing 2 means a 2× multiplier, not 0.02×.
		expect(getOpenOracleCreateValidation({ form: createValidForm({ multiplier: '2' }) }).isValid).toBe(true)
		expect(parseOpenOracleCreateFormSubmission({ form: createValidForm({ multiplier: '2' }), token1Decimals: 18, token2Decimals: 18 }).multiplier).toBe(200)
		expect(parseOpenOracleCreateFormSubmission({ form: createValidForm({ multiplier: '1.5' }), token1Decimals: 18, token2Decimals: 18 }).multiplier).toBe(150)
		expect(getOpenOracleCreateValidation({ form: createValidForm({ multiplier: '0.5' }) }).fieldErrors.multiplier).toBe('Multiplier must be at least 1×.')
	})

	test('sends exactly the settler reward as the ETH value', () => {
		expect(getOpenOracleCreateEthSent('0.25')).toBe(25n * 10n ** 16n)
		const parsed = parseOpenOracleCreateFormSubmission({ form: createValidForm({ settlerRewardEthAmount: '0.25' }), token1Decimals: 18, token2Decimals: 18 })
		expect(parsed.ethValueAttoEth).toBe(25n * 10n ** 16n)
		expect(parsed.settlerRewardAttoEth).toBe(25n * 10n ** 16n)
	})

	test('reports precision errors inline once token decimals are known', () => {
		const form = createValidForm({ exactToken1Report: '0.0000001' })
		expect(getOpenOracleCreateValidation({ form }).fieldErrors.exactToken1Report).toBeUndefined()
		expect(getOpenOracleCreateValidation({ form, token1Decimals: 6, token2Decimals: 18 }).fieldErrors.exactToken1Report).toBe('Enter a valid base token amount.')
		expect(getOpenOracleCreateValidation({ form, token1Decimals: 18, token2Decimals: 18 }).isValid).toBe(true)
	})

	test('derives the implied initial price from the entered amounts', () => {
		expect(getOpenOracleImpliedPrice({ token1Amount: '2', token2Amount: '3' })).toBe(15n * 10n ** 29n)
		expect(getOpenOracleImpliedPrice({ token1Amount: '0', token2Amount: '3' })).toBeUndefined()
		expect(getOpenOracleImpliedPrice({ token1Amount: 'abc', token2Amount: '3' })).toBeUndefined()
	})

	test('explains typed seconds as a readable duration', () => {
		expect(formatOpenOracleSecondsInputHint('86400')).toBe('86400 seconds = 1d 0h 0m')
		expect(formatOpenOracleSecondsInputHint('90')).toBe('90 seconds = 1m')
		expect(formatOpenOracleSecondsInputHint('30')).toBe('30 seconds = 30 s')
		expect(formatOpenOracleSecondsInputHint('soon')).toBeUndefined()
		expect(formatOpenOracleTimingDuration(3600n, true)).toBe('1h 0m')
		expect(formatOpenOracleTimingDuration(12n, false)).toBe('12 blocks')
	})
})

describe('Open Oracle fetched price input', () => {
	test('rounds an 18-decimal quote to six significant digits', () => {
		expect(formatOpenOraclePriceInput(1_234_567_890_123_456_789n, 18)).toBe('1.23457')
		expect(formatOpenOraclePriceInput(123_456_789_000_000_000_000n, 18)).toBe('123.457')
		// Large prices keep every whole digit and drop only the fraction.
		expect(formatOpenOraclePriceInput(12_345_678_900_000_000_000_000_000n, 18)).toBe('12345679')
		expect(formatOpenOraclePriceInput(1_234_567_890_123n, 18)).toBe('0.00000123457')
		expect(formatOpenOraclePriceInput(2n * 10n ** 18n, 18)).toBe('2')
		expect(formatOpenOraclePriceInput(1_999_999_900_000_000_000n, 18)).toBe('2')
		expect(formatOpenOraclePriceInput(0n, 18)).toBe('0')
	})
})

describe('Open Oracle report progress', () => {
	test('combines the stored state with the live clock', () => {
		const clock = (currentTime: bigint) => ({ currentBlockNumber: undefined, currentTime })
		expect(getOpenOracleReportProgress(createProgressReport(), clock(105n))).toBe('awaiting-dispute-window')
		expect(getOpenOracleReportProgress(createProgressReport(), clock(120n))).toBe('dispute-window-open')
		expect(getOpenOracleReportProgress(createProgressReport({ disputeOccurred: true }), clock(120n))).toBe('disputed')
		// Past its settlement time a report is ready to settle, even after a dispute.
		expect(getOpenOracleReportProgress(createProgressReport(), clock(160n))).toBe('ready-to-settle')
		expect(getOpenOracleReportProgress(createProgressReport({ disputeOccurred: true }), clock(160n))).toBe('ready-to-settle')
		expect(getOpenOracleReportProgress(createProgressReport({ isDistributed: true }), clock(160n))).toBe('settled')
	})

	test('uses the block clock for block-based reports and falls back without timing', () => {
		expect(getOpenOracleReportProgress(createProgressReport({ timeType: false }), { currentBlockNumber: 170n, currentTime: 0n })).toBe('ready-to-settle')
		expect(getOpenOracleReportProgress(createProgressReport({ timeType: false }), { currentBlockNumber: undefined, currentTime: 170n })).toBe('pending')
		expect(getOpenOracleReportProgress(createProgressReport({ settlementTime: undefined }), { currentBlockNumber: undefined, currentTime: 170n })).toBe('pending')
		expect(getOpenOracleReportProgress(createProgressReport({ disputeOccurred: true, settlementTime: undefined }), { currentBlockNumber: undefined, currentTime: 170n })).toBe('disputed')
	})

	test('labels progress and treats a dispute as a caution rather than a failure', () => {
		expect(getOpenOracleReportProgressLabel('ready-to-settle')).toBe('Ready to settle')
		expect(getOpenOracleReportProgressLabel('awaiting-dispute-window')).toBe('Waiting for dispute window')
		expect(getOpenOracleReportProgressTone('disputed')).toBe('warning')
		expect(getOpenOracleReportProgressTone('ready-to-settle')).toBe('ok')
	})
})

describe('Open Oracle created report link', () => {
	test('reads the created report ID only from create results', () => {
		const hash = '0x1234000000000000000000000000000000000000000000000000000000000000'
		const created: Parameters<typeof getCreatedOpenOracleReportId>[0] = { action: 'createReportInstance', hash, reportId: 9n }
		expect(getCreatedOpenOracleReportId(created)).toBe(9n)
		expect(getCreatedOpenOracleReportId({ action: 'createReportInstance', hash })).toBeUndefined()
		expect(getCreatedOpenOracleReportId({ action: 'settle', hash })).toBeUndefined()
		expect(getCreatedOpenOracleReportId(undefined)).toBeUndefined()
	})
})
