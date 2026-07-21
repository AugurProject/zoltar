/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { EntityCard } from '../components/EntityCard.js'
import { WarningSurface } from '../components/WarningSurface.js'
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
})
