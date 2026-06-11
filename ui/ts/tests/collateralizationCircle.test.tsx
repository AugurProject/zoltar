/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { CollateralizationCircle } from '../components/CollateralizationCircle.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('CollateralizationCircle', () => {
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

	test('renders the collateralization percentage inside the ring', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={140n * 10n ** 18n} targetCollateralizationPercent={150n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const gaugeValue = documentQueries.getByText('140%')

		expect(gaugeValue).not.toBeNull()
		expect(gaugeValue.className).toBe('collateralization-gauge-value')
	})

	test('applies tone-derived success coloring classes', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={150n * 10n ** 18n} targetCollateralizationPercent={150n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const gauge = document.querySelector('.collateralization-gauge')
		expect(gauge?.className).toContain('tone-success')
	})
})
