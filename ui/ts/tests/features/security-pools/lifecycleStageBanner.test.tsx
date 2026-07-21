/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { LifecycleStageBanner } from '../../../features/security-pools/components/LifecycleStageBanner.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

describe('LifecycleStageBanner', () => {
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
})
