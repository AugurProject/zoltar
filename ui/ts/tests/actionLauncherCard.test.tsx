/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { ActionLauncherCard } from '../components/ActionLauncherCard.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('ActionLauncherCard', () => {
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

	test('uses the warning surface only for warning readiness cards', async () => {
		const renderedComponent = await renderIntoDocument(
			<div>
				<ActionLauncherCard action={{ actionLabel: 'Warning Action', description: 'Warning details.', key: 'warning', onAction: () => undefined, readiness: 'warning', title: 'Warning Action' }} />
				<ActionLauncherCard action={{ actionLabel: 'Ready Action', description: 'Ready details.', key: 'ready', onAction: () => undefined, readiness: 'ready', title: 'Ready Action' }} />
				<ActionLauncherCard action={{ actionLabel: 'Blocked Action', blocker: 'Blocked.', description: 'Blocked details.', key: 'blocked', readiness: 'blocked', title: 'Blocked Action' }} />
			</div>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('heading', { name: 'Warning Action' }) as HTMLElement).closest('.warning-surface')).not.toBeNull()
		expect((documentQueries.getByRole('heading', { name: 'Ready Action' }) as HTMLElement).closest('.warning-surface')).toBeNull()
		expect((documentQueries.getByRole('heading', { name: 'Blocked Action' }) as HTMLElement).closest('.warning-surface')).toBeNull()
		expect(document.body.querySelectorAll('.warning-surface.action-launcher-card')).toHaveLength(1)
	})
})
