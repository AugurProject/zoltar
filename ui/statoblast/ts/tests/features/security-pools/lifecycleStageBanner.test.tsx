/// <reference types="bun-types" />

import { LifecycleStageBanner } from '@zoltar/ui-core-shared/components/LifecycleStageBanner.js'
import { readCoreSharedCssSource } from '@zoltar/ui-core-shared/tests/testUtils/coreSharedCss.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { describe, expect, test } from 'bun:test'

describe('LifecycleStageBanner', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('preserves lifecycle tone colors after the shared flat surface rule', async () => {
		const renderedComponent = await renderIntoDocument(
			<>
				<LifecycleStageBanner flat stage={{ availableActions: [], blockedActions: [], key: 'resolved', label: 'Resolved', tone: 'success' }} />
				<LifecycleStageBanner flat stage={{ availableActions: [], blockedActions: [], key: 'warning', label: 'Warning', tone: 'warning' }} />
			</>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.lifecycle-stage-banner.flat.success')).not.toBeNull()
		expect(document.body.querySelector('.warning-surface.lifecycle-stage-banner.flat')).not.toBeNull()

		const cssSource = readCoreSharedCssSource()
		const baseFlatRuleIndex = cssSource.indexOf('.lifecycle-stage-banner.flat {')
		const warningFlatRuleIndex = cssSource.indexOf('.warning-surface.lifecycle-stage-banner.flat {')
		const criticalFlatRuleIndex = cssSource.indexOf('.lifecycle-stage-banner.flat.critical {')
		const successFlatRuleIndex = cssSource.indexOf('.lifecycle-stage-banner.flat.success {')

		expect(baseFlatRuleIndex).toBeGreaterThanOrEqual(0)
		expect(warningFlatRuleIndex).toBeGreaterThan(baseFlatRuleIndex)
		expect(criticalFlatRuleIndex).toBeGreaterThan(warningFlatRuleIndex)
		expect(successFlatRuleIndex).toBeGreaterThan(criticalFlatRuleIndex)
	})

	test('renders stage detail as plain text without a loading spinner for standard and warning stages', async () => {
		const renderedComponent = await renderIntoDocument(
			<>
				<LifecycleStageBanner stage={{ availableActions: [], blockedActions: [], detail: 'Loading reporting details.', key: 'reportingOpen', label: 'Reporting Open', tone: 'success' }} />
				<LifecycleStageBanner stage={{ availableActions: [], blockedActions: [], detail: 'Loading warning details.', key: 'warning', label: 'Warning', tone: 'warning' }} />
			</>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Loading reporting details.').classList.contains('detail')).toBe(true)
		expect(documentQueries.getByText('Loading warning details.').classList.contains('detail')).toBe(true)
		expect(documentQueries.queryByRole('status')).toBeNull()
		expect(document.body.querySelector('.spinner')).toBeNull()
	})
})
