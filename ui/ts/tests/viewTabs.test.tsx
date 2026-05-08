/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { act } from 'preact/test-utils'
import { ViewTabs } from '../components/ViewTabs.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function requireButton(value: HTMLButtonElement | undefined, label: string) {
	if (value === undefined) throw new Error(`Expected tab button for ${label}`)
	return value
}

describe('ViewTabs', () => {
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

	test('supports keyboard navigation and exposes panel linkage metadata', async () => {
		let selectedValue = 'overview'
		const renderedComponent = await renderIntoDocument(
			<>
				<ViewTabs
					ariaLabel='Example Tabs'
					value={selectedValue}
					onChange={value => {
						selectedValue = value
					}}
					options={[
						{ label: 'Overview', panelId: 'overview-panel', value: 'overview' },
						{ label: 'Details', panelId: 'details-panel', value: 'details' },
						{ disabled: true, label: 'Disabled', panelId: 'disabled-panel', value: 'disabled' },
					]}
				/>
				<section id='overview-panel' role='tabpanel' />
				<section id='details-panel' role='tabpanel' />
			</>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const tabs = within(document.body).getAllByRole('tab') as HTMLButtonElement[]
		const overviewTab = requireButton(tabs[0], 'overview')
		const detailsTab = requireButton(tabs[1], 'details')

		expect(overviewTab.getAttribute('aria-controls')).toBe('overview-panel')

		overviewTab.focus()
		await act(() => {
			fireEvent.keyDown(overviewTab, { key: 'ArrowRight' })
		})

		expect(selectedValue).toBe('details')
		expect(document.activeElement).toBe(detailsTab)

		await act(() => {
			fireEvent.keyDown(detailsTab, { key: 'Home' })
		})

		expect(selectedValue).toBe('overview')
		expect(document.activeElement).toBe(overviewTab)
	})

	test('renders real links when href metadata is provided', async () => {
		const renderedComponent = await renderIntoDocument(
			<ViewTabs
				ariaLabel='Route Tabs'
				value='overview'
				onChange={() => undefined}
				options={[
					{ href: '#/overview', label: 'Overview', value: 'overview' },
					{ href: '#/details', label: 'Details', value: 'details' },
				]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const overviewLink = within(document.body).getByRole('tab', { name: 'Overview' }) as HTMLAnchorElement
		expect(overviewLink.tagName).toBe('A')
		expect(overviewLink.getAttribute('href')).toBe('#/overview')
	})
})
