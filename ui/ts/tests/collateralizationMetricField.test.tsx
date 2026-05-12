/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
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
	})

	test('colors the metric green when it is strictly above the security multiplier threshold', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationMetricField collateralizationPercent={201n * 10n ** 18n} repPerEthSource='mock' repPerEthSourceUrl={undefined} securityBondAllowance={1n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body)
			.getByText(/201\.00 %/)
			.closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-success')
	})

	test('colors the metric red when it is at or below the security multiplier threshold', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationMetricField collateralizationPercent={200n * 10n ** 18n} repPerEthSource='mock' repPerEthSourceUrl={undefined} securityBondAllowance={1n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body)
			.getByText(/200\.00 %/)
			.closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-danger')
	})
})
