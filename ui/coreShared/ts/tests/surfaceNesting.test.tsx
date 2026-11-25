/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { EntityCard } from '../components/EntityCard.js'
import { WarningSurface } from '../components/WarningSurface.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { readFileSync } from 'node:fs'

const readFeatureCssSource = (owner: 'statoblastShared' | 'zoltarShared', stylesheet = 'index.css') => readFileSync(`ui/${owner}/css/${stylesheet}`, 'utf8')

describe('flat nested surfaces', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
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

	test('keeps question preview timeline rows flat', () => {
		const zoltarCssSource = readFeatureCssSource('zoltarShared', 'questions.css')
		const timelineItemRule = zoltarCssSource.slice(zoltarCssSource.indexOf('.question-preview-timeline-item {'), zoltarCssSource.indexOf('.question-preview-timeline-label,'))

		expect(timelineItemRule).toContain('border-radius: 0')
		expect(timelineItemRule).toContain('background: transparent')
	})

	test('aligns workflow actions as rows and keeps share totals with the distribution', () => {
		const cssSource = readFeatureCssSource('statoblastShared')
		const distributionRule = cssSource.match(/\.trading-share-distribution \.ranked-bar-item-value button\.currency-value\.copyable \{[^}]*\}/)?.[0]

		expect(cssSource).toContain('.vault-action-launcher-grid {\n\tgrid-template-columns: minmax(0, 1fr)')
		expect(cssSource).toContain('.vault-action-launcher-grid .action-launcher-card {')
		expect(cssSource).toContain('.question-ledger-strip-stats button.currency-value.copyable')
		expect(cssSource).toContain('.trading-holdings-layout {\n\tgrid-template-columns: minmax(0, 1fr)')
		expect(distributionRule).toContain('white-space: nowrap')
	})
})
