/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
import { readFileSync } from 'node:fs'
import { CollateralizationMetricField } from '../components/CollateralizationMetricField.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('CollateralizationMetricField', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders the no-active-allowance selected-vault metric as normal text inside the standard card wrapper', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationMetricField className='entity-metric' collateralizationPercent={undefined} repPerEthSource='v3' repPerEthSourceUrl='https://example.com/uniswap-v3' securityBondAllowance={0n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const noActiveAllowanceValue = documentQueries.getByText('No active allowance')
		const metricField = noActiveAllowanceValue.closest('div')

		expect(metricField?.className).toBe('entity-metric')
		expect(noActiveAllowanceValue.tagName).toBe('STRONG')
		expect(noActiveAllowanceValue.className).toBe('metric-field-value')
	})

	test('renders a descriptive message when the REP/ETH quote is unavailable', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationMetricField collateralizationPercent={undefined} repPerEthSource={undefined} repPerEthSourceUrl={undefined} securityBondAllowance={1n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Awaiting REP/ETH price')).not.toBeNull()
		expect(documentQueries.getByTitle('REP/ETH price source is unavailable until a quote loads.')).not.toBeNull()
	})

	test('colors the metric red when it is below the security multiplier threshold', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationMetricField collateralizationPercent={199n * 10n ** 18n} repPerEthSource='mock' repPerEthSourceUrl={undefined} securityBondAllowance={1n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body)
			.getByText(/199\.00 %/)
			.closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-danger')
	})

	test('colors the metric green when it is equal to the security multiplier threshold', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationMetricField collateralizationPercent={200n * 10n ** 18n} repPerEthSource='mock' repPerEthSourceUrl={undefined} securityBondAllowance={1n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body)
			.getByText(/200\.00 %/)
			.closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-success')
	})

	test('colors the metric green when it is above the security multiplier threshold', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationMetricField collateralizationPercent={201n * 10n ** 18n} repPerEthSource='mock' repPerEthSourceUrl={undefined} securityBondAllowance={1n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body)
			.getByText(/201\.00 %/)
			.closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-success')
	})

	test('uses source-aware tooltip copy for simulation mock collateralization', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationMetricField collateralizationPercent={201n * 10n ** 18n} repPerEthSource='mock' repPerEthSourceUrl={undefined} securityBondAllowance={1n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByTitle('Uses the simulation REP/ETH mock price.')).not.toBeNull()
	})

	test('uses source-aware tooltip copy for live Uniswap collateralization quotes', async () => {
		const renderedV4Component = await renderIntoDocument(<CollateralizationMetricField collateralizationPercent={201n * 10n ** 18n} repPerEthSource='v4' repPerEthSourceUrl='https://example.com/uniswap-v4' securityBondAllowance={1n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedV4Component.cleanup

		let documentQueries = within(document.body)
		expect(documentQueries.getByTitle('Uses the live Uniswap V4 REP/ETH quote.')).not.toBeNull()

		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const renderedV3Component = await renderIntoDocument(<CollateralizationMetricField collateralizationPercent={201n * 10n ** 18n} repPerEthSource='v3' repPerEthSourceUrl='https://example.com/uniswap-v3' securityBondAllowance={1n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedV3Component.cleanup

		documentQueries = within(document.body)
		expect(documentQueries.getByTitle('Uses the live Uniswap V3 REP/ETH quote.')).not.toBeNull()
	})

	test('keeps success and danger color rules specific enough for every collateralization container', () => {
		const cssSource = readFileSync('ui/css/index.css', 'utf8')

		for (const selector of ['.workflow-metric-grid strong.metric-value-success', '.workflow-question-grid strong.metric-value-success', '.workflow-vault-grid strong.metric-value-success', '.entity-metric strong.metric-value-success', '.selected-pool-context-grid strong.metric-value-success']) {
			expect(cssSource).toContain(selector)
		}

		for (const selector of ['.workflow-metric-grid strong.metric-value-danger', '.workflow-question-grid strong.metric-value-danger', '.workflow-vault-grid strong.metric-value-danger', '.entity-metric strong.metric-value-danger', '.selected-pool-context-grid strong.metric-value-danger']) {
			expect(cssSource).toContain(selector)
		}
	})
})
