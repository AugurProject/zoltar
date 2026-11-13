import { describe, expect, test } from 'bun:test'
import { selectScenarios } from './layoutScan.mts'

describe('layout scan scenario selection', () => {
	const registered = ['baseline', 'deployed', 'two-questions']

	test('scans every registered scenario by default', () => {
		expect(selectScenarios('zoltar', registered, 'all')).toEqual(registered)
	})

	test('keeps requested scenarios the app registers', () => {
		expect(selectScenarios('zoltar', registered, ['deployed'])).toEqual(['deployed'])
	})

	test('rejects a scenario the app does not register instead of scanning the baseline under its name', () => {
		expect(() => selectScenarios('zoltar', registered, ['deployed', 'trading-funded'])).toThrow('The zoltar app does not register the simulation scenario trading-funded. Registered: baseline, deployed, two-questions.')
	})
})
