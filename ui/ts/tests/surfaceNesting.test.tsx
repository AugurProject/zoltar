/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { EntityCard } from '../components/EntityCard.js'
import { WarningSurface } from '../components/WarningSurface.js'
import { LifecycleStageBanner } from '../features/security-pools/components/LifecycleStageBanner.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('flat nested surfaces', () => {
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

	test('marks entity cards as flat when they are composed inside another surface', async () => {
		const renderedComponent = await renderIntoDocument(
			<EntityCard surface='flat' title='Nested record'>
				<p>Record details</p>
			</EntityCard>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.entity-card.flat')).not.toBeNull()
	})

	test('marks warning callouts as flat when they are composed inside another surface', async () => {
		const renderedComponent = await renderIntoDocument(<WarningSurface surface='flat'>Check this state.</WarningSurface>)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.warning-surface.flat')).not.toBeNull()
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

		const cssSource = readFileSync('ui/css/index.css', 'utf8')
		const baseFlatRuleIndex = cssSource.indexOf('.lifecycle-stage-banner.flat {')
		const warningFlatRuleIndex = cssSource.indexOf('.warning-surface.lifecycle-stage-banner.flat {')
		const criticalFlatRuleIndex = cssSource.indexOf('.lifecycle-stage-banner.flat.critical {')
		const successFlatRuleIndex = cssSource.indexOf('.lifecycle-stage-banner.flat.success {')

		expect(baseFlatRuleIndex).toBeGreaterThanOrEqual(0)
		expect(warningFlatRuleIndex).toBeGreaterThan(baseFlatRuleIndex)
		expect(criticalFlatRuleIndex).toBeGreaterThan(warningFlatRuleIndex)
		expect(successFlatRuleIndex).toBeGreaterThan(criticalFlatRuleIndex)
	})

	test('keeps loaded question previews and timeline rows flat', () => {
		const cssSource = readFileSync('ui/css/index.css', 'utf8')
		const loadedPreviewRule = cssSource.slice(cssSource.indexOf('.loaded-question-preview {'), cssSource.indexOf('.field-inline {'))
		const timelineItemRule = cssSource.slice(cssSource.indexOf('.question-preview-timeline-item {'), cssSource.indexOf('.question-preview-timeline-label,'))

		expect(loadedPreviewRule).toContain('border-radius: 0')
		expect(loadedPreviewRule).toContain('background: transparent')
		expect(timelineItemRule).toContain('border-radius: 0')
		expect(timelineItemRule).toContain('background: transparent')
	})

	test('aligns workflow actions as rows and keeps share totals with the distribution', () => {
		const cssSource = readFileSync('ui/css/index.css', 'utf8')
		const totalRule = cssSource.slice(cssSource.indexOf('.trading-share-callouts-total {'), cssSource.indexOf('.security-pool-strip-meter {'))

		expect(cssSource).toContain('.vault-action-launcher-grid {\n\tgrid-template-columns: minmax(0, 1fr)')
		expect(cssSource).toContain('.vault-action-launcher-grid .action-launcher-card {')
		expect(cssSource).toContain('.security-pool-strip-stats button.currency-value.copyable')
		expect(cssSource).toContain('.trading-holdings-layout {\n\tgrid-template-columns: minmax(0, 1fr)')
		expect(totalRule).toContain('grid-template-columns: minmax(0, 1fr) auto')
		expect(totalRule).toContain('.trading-share-distribution .ranked-bar-item-value button.currency-value.copyable')
		expect(totalRule).toContain('white-space: nowrap')
	})
})
