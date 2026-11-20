import { describe, expect, test } from 'bun:test'
import { buildSourceIndex, findSources, parseViewports, selectScenarios } from './layoutScan.mts'

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

describe('layout scan viewport option', () => {
	test('parses comma-separated viewports', () => {
		expect(parseViewports('1440x900, 390x844')).toEqual([
			{ width: 1440, height: 900 },
			{ width: 390, height: 844 },
		])
	})

	test('rejects zero dimensions before scanning, like browser smoke', () => {
		expect(() => parseViewports('0x844')).toThrow('dimensions must be positive')
		expect(() => parseViewports('390x0')).toThrow('dimensions must be positive')
		expect(() => parseViewports('390x844,0x0')).toThrow("Invalid viewport '0x0'")
	})
})

describe('layout scan source lookup', () => {
	test('finds the stylesheet rule and the component that use a class', async () => {
		const sources = findSources(await buildSourceIndex(), ['simulation-strip-scenario'])
		expect(sources.some(source => source.startsWith('ui/coreShared/css/simulation-banner.css:'))).toBe(true)
		expect(sources.some(source => source.startsWith('ui/coreShared/ts/components/SimulationStripSummary.tsx:'))).toBe(true)
	})
})
