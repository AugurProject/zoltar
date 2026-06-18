/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
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
		const overviewTab = requireButton(tabs[0] as HTMLButtonElement, 'overview')
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

	test('supports wrap-around and disabled-option skipping for keyboard navigation', async () => {
		let selectedValue = 'overview'
		const renderedComponent = await renderIntoDocument(
			<ViewTabs
				ariaLabel='Wrap Tabs'
				value={selectedValue}
				onChange={value => {
					selectedValue = value
				}}
				options={[
					{ label: 'Overview', value: 'overview' },
					{ disabled: true, label: 'Paused', value: 'paused' },
					{ label: 'Reports', value: 'reports' },
				]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const tabs = within(document.body).getAllByRole('tab') as HTMLButtonElement[]
		const overviewTab = requireButton(tabs[0], 'overview')
		expect(overviewTab).toBeDefined()

		await act(() => {
			fireEvent.keyDown(overviewTab, { key: 'ArrowLeft' })
		})
		expect(selectedValue).toBe('reports')

		await act(() => {
			const reportsTab = document.getElementById('wrap-tabs-reports-tab')
			if (reportsTab === null) throw new Error('Expected reports tab to exist')
			fireEvent.keyDown(reportsTab as HTMLElement, { key: 'ArrowRight' })
		})
		expect(selectedValue).toBe('overview')

		await act(() => {
			fireEvent.keyDown(overviewTab as HTMLButtonElement, { key: 'End' })
		})
		expect(selectedValue).toBe('reports')
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

	test('uses rendered grouped options for keyboard navigation', async () => {
		let selectedValue = 'overview'
		const renderedComponent = await renderIntoDocument(
			<ViewTabs
				ariaLabel='Grouped Tabs'
				value={selectedValue}
				onChange={value => {
					selectedValue = value
				}}
				groups={[
					{ ariaLabel: 'Primary tabs', values: ['overview'] },
					{ ariaLabel: 'Secondary tabs', values: ['reports'] },
				]}
				options={[
					{ label: 'Overview', value: 'overview' },
					{ label: 'Hidden', value: 'hidden' },
					{ label: 'Reports', value: 'reports' },
				]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const overviewTab = within(document.body).getByRole('tab', { name: 'Overview' })
		const reportsTab = within(document.body).getByRole('tab', { name: 'Reports' })
		expect(within(document.body).queryByRole('tab', { name: 'Hidden' })).toBeNull()

		overviewTab.focus()
		await act(() => {
			fireEvent.keyDown(overviewTab, { key: 'ArrowRight' })
		})

		expect(selectedValue).toBe('reports')
		expect(document.activeElement).toBe(reportsTab)
	})

	test('renders duplicate grouped values only once', async () => {
		const renderedComponent = await renderIntoDocument(
			<ViewTabs
				ariaLabel='Duplicate Grouped Tabs'
				value='overview'
				onChange={() => undefined}
				groups={[
					{ ariaLabel: 'Primary tabs', values: ['overview', 'reports'] },
					{ ariaLabel: 'Repeated tabs', values: ['reports'] },
				]}
				options={[
					{ label: 'Overview', value: 'overview' },
					{ label: 'Reports', value: 'reports' },
				]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const reportsTabs = within(document.body).getAllByRole('tab', { name: 'Reports' })
		expect(reportsTabs).toHaveLength(1)
	})
})
