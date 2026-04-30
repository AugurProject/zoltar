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

	test('keeps the no-active-allowance selected-vault metric inside the standard card wrapper', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationMetricField className='entity-metric' collateralizationPercent={undefined} repEthSource='v3' repEthSourceUrl='https://example.com/uniswap-v3' securityBondAllowance={0n} securityMultiplier={2n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const noActiveAllowanceValue = documentQueries.getByText('No active allowance')
		const metricField = noActiveAllowanceValue.closest('div')

		expect(metricField?.className).toBe('entity-metric')
		expect(noActiveAllowanceValue.tagName).toBe('STRONG')
		expect(noActiveAllowanceValue.className).toBe('metric-value-danger')
	})
})
