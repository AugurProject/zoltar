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

		const tabs = within(document.body).getAllByRole('button') as HTMLButtonElement[]
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
		let selectedValue = 'overview'
		const renderedComponent = await renderIntoDocument(
			<ViewTabs
				ariaLabel='Route Tabs'
				semantics='navigation'
				value='overview'
				onChange={value => {
					selectedValue = value
				}}
				options={[
					{ href: '#/overview', label: 'Overview', value: 'overview' },
					{ href: '#/details', label: 'Details', value: 'details' },
				]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const overviewLink = within(document.body).getByRole('link', { name: 'Overview' }) as HTMLAnchorElement
		expect(overviewLink.tagName).toBe('A')
		expect(overviewLink.getAttribute('href')).toBe('#/overview')
		expect(overviewLink.getAttribute('aria-current')).toBe('page')

		const locationBeforeArrowKey = window.location.href
		overviewLink.focus()
		await act(() => {
			fireEvent.keyDown(overviewLink, { key: 'ArrowRight' })
		})

		expect(selectedValue).toBe('overview')
		expect(document.activeElement).toBe(overviewLink)
		expect(window.location.href).toBe(locationBeforeArrowKey)

		const preventNativeNavigation = (event: Event) => event.preventDefault()
		document.body.addEventListener('click', preventNativeNavigation)
		for (const clickInit of [{ altKey: true }, { button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
			await act(() => {
				fireEvent.click(overviewLink, clickInit)
			})
			expect(selectedValue).toBe('overview')
			expect(window.location.href).toBe(locationBeforeArrowKey)
		}

		const detailsLink = within(document.body).getByRole('link', { name: 'Details' })
		await act(() => {
			fireEvent.click(detailsLink)
		})
		expect(selectedValue).toBe('details')
		document.body.removeEventListener('click', preventNativeNavigation)
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

		const overviewTab = within(document.body).getByRole('button', { name: 'Overview' })
		const reportsTab = within(document.body).getByRole('button', { name: 'Reports' })
		expect(within(document.body).queryByRole('button', { name: 'Hidden' })).toBeNull()

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

		const reportsTabs = within(document.body).getAllByRole('button', { name: 'Reports' })
		expect(reportsTabs).toHaveLength(1)
	})

	test('avoids animated active-tab scrolling when reduced motion is requested', async () => {
		const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
		const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
		const originalMatchMedia = window.matchMedia
		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
		const originalScrollTo = HTMLElement.prototype.scrollTo
		const requestedBehaviors: (ScrollBehavior | undefined)[] = []
		let scrollIntoViewCalls = 0
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 200 })
		Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 400 })
		window.matchMedia = query => ({
			addEventListener: () => undefined,
			addListener: () => undefined,
			dispatchEvent: () => false,
			matches: query === '(prefers-reduced-motion: reduce)',
			media: query,
			onchange: null,
			removeEventListener: () => undefined,
			removeListener: () => undefined,
		})
		HTMLElement.prototype.scrollIntoView = () => {
			scrollIntoViewCalls += 1
		}
		HTMLElement.prototype.scrollTo = (optionsOrX?: number | ScrollToOptions, _y?: number) => {
			const options = typeof optionsOrX === 'object' ? optionsOrX : undefined
			requestedBehaviors.push(typeof options === 'object' ? options.behavior : undefined)
		}

		try {
			const renderedComponent = await renderIntoDocument(
				<ViewTabs
					ariaLabel='Motion Tabs'
					value='reports'
					onChange={() => undefined}
					options={[
						{ label: 'Overview', value: 'overview' },
						{ label: 'Reports', value: 'reports' },
					]}
				/>,
			)
			cleanupRenderedComponent = renderedComponent.cleanup

			expect(requestedBehaviors).toEqual(['auto'])
			expect(scrollIntoViewCalls).toBe(0)
		} finally {
			window.matchMedia = originalMatchMedia
			HTMLElement.prototype.scrollIntoView = originalScrollIntoView
			HTMLElement.prototype.scrollTo = originalScrollTo
			if (clientWidthDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
			else Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
			if (scrollWidthDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
			else Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidthDescriptor)
		}
	})

	test('keeps the active tab visible when a horizontal tab strip becomes narrower', async () => {
		const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
		const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
		const originalResizeObserver = globalThis.ResizeObserver
		const originalScrollTo = HTMLElement.prototype.scrollTo
		let clientWidth = 400
		let resizeCallback: ResizeObserverCallback | undefined
		const requestedScrollPositions: number[] = []
		class MockResizeObserver implements ResizeObserver {
			constructor(callback: ResizeObserverCallback) {
				resizeCallback = callback
			}
			disconnect() {}
			observe() {}
			unobserve() {}
		}
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth })
		Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 400 })
		Reflect.set(globalThis, 'ResizeObserver', MockResizeObserver)
		HTMLElement.prototype.scrollTo = (optionsOrX?: number | ScrollToOptions) => {
			if (typeof optionsOrX === 'object' && optionsOrX.left !== undefined) requestedScrollPositions.push(optionsOrX.left)
		}

		try {
			const renderedComponent = await renderIntoDocument(
				<ViewTabs
					ariaLabel='Responsive Tabs'
					value='migration'
					onChange={() => undefined}
					options={[
						{ label: 'Questions', value: 'questions' },
						{ label: 'Create Question', value: 'create' },
						{ label: 'Fork Zoltar', value: 'fork' },
						{ label: 'Migrate REP', value: 'migration' },
					]}
				/>,
			)
			cleanupRenderedComponent = renderedComponent.cleanup
			expect(requestedScrollPositions).toEqual([])

			clientWidth = 200
			await act(() => resizeCallback?.([], {} as ResizeObserver))

			expect(requestedScrollPositions.length).toBe(1)
		} finally {
			HTMLElement.prototype.scrollTo = originalScrollTo
			if (originalResizeObserver === undefined) Reflect.deleteProperty(globalThis, 'ResizeObserver')
			else Reflect.set(globalThis, 'ResizeObserver', originalResizeObserver)
			if (clientWidthDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
			else Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
			if (scrollWidthDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
			else Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidthDescriptor)
		}
	})
})
