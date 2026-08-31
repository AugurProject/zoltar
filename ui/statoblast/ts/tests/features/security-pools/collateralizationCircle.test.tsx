/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { CollateralizationCircle } from '../../../features/security-pools/components/CollateralizationCircle.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

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
		const gauge = document.querySelector('.collateralization-gauge')
		const gaugeValue = documentQueries.getByText('140%')

		expect(gauge?.className).not.toContain('has-external-value')
		expect(gauge?.getAttribute('title')).toBe('Collateralization: 140%; target: 150%')
		expect(gaugeValue).not.toBeNull()
		expect(documentQueries.getByText('Target 150%')).not.toBeNull()
		expect(gaugeValue.className).toBe('collateralization-gauge-value')
	})

	test('shows oversized collateralization percentages visibly beside a compact ring value', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={3667n * 10n ** 18n} targetCollateralizationPercent={150n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const gauge = document.querySelector('.collateralization-gauge')
		const gaugeValue = documentQueries.getByText('>999%')

		expect(gauge?.className).not.toContain('has-external-value')
		expect(gauge?.getAttribute('title')).toBe('Collateralization: 3 667%; target: 150%')
		expect(gaugeValue.className).toBe('collateralization-gauge-value')
		expect(documentQueries.getByText('Above target')).not.toBeNull()
		expect(documentQueries.getByText('3 667%')).not.toBeNull()
	})

	test('describes oversized collateralization relative to an equally oversized target', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={1000n * 10n ** 18n} targetCollateralizationPercent={1000n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('>999%')).not.toBeNull()
		expect(documentQueries.getByText('At target')).not.toBeNull()
		expect(documentQueries.queryByText('Above target')).toBeNull()
		expect(documentQueries.getByText('Target 1 000%')).not.toBeNull()
	})

	test('describes oversized collateralization below a higher target', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={1000n * 10n ** 18n} targetCollateralizationPercent={1200n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('>999%')).not.toBeNull()
		expect(documentQueries.getByText('Below target')).not.toBeNull()
		expect(documentQueries.queryByText('Above target')).toBeNull()
		expect(documentQueries.getByText('Target 1 200%')).not.toBeNull()
	})

	test('keeps the largest displayed collateralization label inside the ring', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={1000n * 10n ** 18n} targetCollateralizationPercent={150n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const gauge = document.querySelector('.collateralization-gauge')
		const documentQueries = within(document.body)
		const gaugeValue = documentQueries.getByText('>999%')

		expect(gauge?.className).not.toContain('has-external-value')
		expect(gauge?.getAttribute('title')).toBe('Collateralization: 1 000%; target: 150%')
		expect(documentQueries.getByText('1 000%')).not.toBeNull()
		expect(gaugeValue.parentElement?.className).toContain('collateralization-gauge')
	})

	test('applies tone-derived success coloring classes', async () => {
		const renderedComponent = await renderIntoDocument(<CollateralizationCircle collateralizationPercent={150n * 10n ** 18n} targetCollateralizationPercent={150n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const gauge = document.querySelector('.collateralization-gauge')
		expect(gauge?.className).toContain('tone-success')
	})
})
