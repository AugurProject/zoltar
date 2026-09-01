/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { InlineHint } from '../components/InlineHint.js'

describe('InlineHint', () => {
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

	test('renders a compact info control with the full message in the popover', async () => {
		const renderedComponent = await renderIntoDocument(<InlineHint message='Need more REP before continuing.' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const toggle = documentQueries.getByRole('button', { name: 'More info' })
		expect(toggle).toBeDefined()
		await act(() => {
			fireEvent.click(toggle)
		})
		expect(documentQueries.getByText('Need more REP before continuing.')).toBeDefined()
	})

	test('keeps the popover visible after touch-style activation until dismissed', async () => {
		const renderedComponent = await renderIntoDocument(<InlineHint message='Need more REP before continuing.' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const toggle = documentQueries.getByRole('button', { name: 'More info' })
		await act(() => {
			fireEvent.click(toggle)
		})
		expect(toggle.getAttribute('aria-expanded')).toBe('true')
		expect(documentQueries.getByRole('note').textContent).toContain('Need more REP before continuing.')

		await act(() => {
			document.dispatchEvent(new window.PointerEvent('pointerdown'))
		})
		expect(documentQueries.queryByRole('note')).toBeNull()
		expect(toggle.getAttribute('aria-expanded')).toBe('false')
	})
})
