/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { getTermPopoverShift, Term } from '../components/Term.js'
import { fireEvent, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const definition = { definition: 'The REP amount at which escalation stops.', href: 'https://example.test/docs/reference/glossary.html#non-decision-threshold', label: 'Non-decision threshold' }

function getPopover(trigger: HTMLElement) {
	const popoverId = trigger.getAttribute('aria-controls')
	if (popoverId === null) throw new Error('Expected the term trigger to control a popover')
	const popover = document.getElementById(popoverId)
	if (popover === null) throw new Error('Expected the term popover to be rendered')
	return popover
}

describe('Term', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('discloses the definition and a guide link from an inline button', async () => {
		const renderedComponent = await renderIntoDocument(
			<p>
				Two sides reached the <Term {...definition}>non-decision threshold</Term>.
			</p>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const trigger = within(document.body).getByRole('button', { name: 'non-decision threshold' })
		const popover = getPopover(trigger)
		expect(trigger.getAttribute('aria-expanded')).toBe('false')
		expect(popover.hidden).toBe(true)

		await act(() => {
			fireEvent.click(trigger)
		})
		expect(trigger.getAttribute('aria-expanded')).toBe('true')
		expect(popover.hidden).toBe(false)
		expect(popover.textContent).toContain('Non-decision threshold')
		expect(popover.textContent).toContain(definition.definition)
		const link = within(popover).getByRole('link', { name: 'Read more in the guide' })
		expect(link.getAttribute('href')).toBe(definition.href)
		expect(link.getAttribute('target')).toBe('_blank')

		await act(() => {
			fireEvent.click(trigger)
		})
		expect(trigger.getAttribute('aria-expanded')).toBe('false')
		expect(popover.hidden).toBe(true)
	})

	test('closes on Escape without letting an enclosing dialog see the key, and on an outside pointer', async () => {
		let dialogEscapeCount = 0
		const renderedComponent = await renderIntoDocument(
			<div
				onKeyDown={event => {
					if (event.key === 'Escape') dialogEscapeCount += 1
				}}
			>
				<Term {...definition} />
				<button type='button'>Elsewhere</button>
			</div>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const trigger = within(document.body).getByRole('button', { name: 'Non-decision threshold' })
		await act(() => {
			fireEvent.click(trigger)
		})
		const link = within(getPopover(trigger)).getByRole('link', { name: 'Read more in the guide' })
		await act(() => {
			fireEvent.keyDown(link, { key: 'Escape' })
		})
		expect(trigger.getAttribute('aria-expanded')).toBe('false')
		expect(document.activeElement).toBe(trigger)
		expect(dialogEscapeCount).toBe(0)

		// Once the definition is closed, Escape reaches the enclosing dialog again.
		await act(() => {
			fireEvent.keyDown(trigger, { key: 'Escape' })
		})
		expect(dialogEscapeCount).toBe(1)

		await act(() => {
			fireEvent.click(trigger)
		})
		expect(trigger.getAttribute('aria-expanded')).toBe('true')
		await act(() => {
			within(document.body)
				.getByRole('button', { name: 'Elsewhere' })
				.dispatchEvent(new Event('pointerdown', { bubbles: true }))
		})
		expect(trigger.getAttribute('aria-expanded')).toBe('false')
	})

	test('closes when a reused instance starts describing another term', async () => {
		const renderedComponent = await renderIntoDocument(<Term {...definition} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const trigger = within(document.body).getByRole('button', { name: 'Non-decision threshold' })
		await act(() => {
			fireEvent.click(trigger)
		})
		expect(trigger.getAttribute('aria-expanded')).toBe('true')

		await act(() => {
			render(<Term definition='A separate REP ledger.' href='https://example.test/docs/reference/glossary.html#universe' label='Universe' />, renderedComponent.container)
		})
		const nextTrigger = within(document.body).getByRole('button', { name: 'Universe' })
		expect(nextTrigger.getAttribute('aria-expanded')).toBe('false')
		expect(getPopover(nextTrigger).hidden).toBe(true)
	})

	test('keeps the popover inside the viewport', () => {
		expect(getTermPopoverShift(20, 300, 1440)).toBe(0)
		expect(getTermPopoverShift(200, 320, 390)).toBe(-138)
		expect(getTermPopoverShift(4, 320, 390)).toBe(4)
		// A popover wider than the viewport keeps its start edge visible.
		expect(getTermPopoverShift(100, 500, 390)).toBe(-92)
	})
})
