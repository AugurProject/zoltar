/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '../testUtils/queries'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { AppPageHeading } from '../../app/components/AppPageHeading.js'
import { formatAppDocumentTitle, getAppPageTitle, type AppPageTitleInput } from '../../app/lib/appPageTitle.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

const baseInput: AppPageTitleInput = {
	activeOpenOracleView: 'browse',
	activeSecurityPoolsView: 'browse',
	activeZoltarView: 'questions',
	route: 'zoltar',
}

describe('app page titles', () => {
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

	test('maps routes and active views to user-facing page titles', () => {
		const cases: Array<{ input: AppPageTitleInput; title: ReturnType<typeof getAppPageTitle> }> = [
			{ input: { ...baseInput, route: 'deploy' }, title: 'Deploy Contracts' },
			{ input: { ...baseInput, route: 'zoltar', activeZoltarView: 'questions' }, title: 'Questions' },
			{ input: { ...baseInput, route: 'zoltar', activeZoltarView: 'create' }, title: 'Create Question' },
			{ input: { ...baseInput, route: 'zoltar', activeZoltarView: 'fork' }, title: 'Fork Zoltar' },
			{ input: { ...baseInput, route: 'zoltar', activeZoltarView: 'migrate' }, title: 'Migrate REP' },
			{ input: { ...baseInput, route: 'security-pools', activeSecurityPoolsView: 'browse' }, title: 'Security Pools' },
			{ input: { ...baseInput, route: 'security-pools', activeSecurityPoolsView: 'create' }, title: 'Create Security Pool' },
			{ input: { ...baseInput, route: 'security-pools', activeSecurityPoolsView: 'operate' }, title: 'Manage Security Pool' },
			{ input: { ...baseInput, route: 'open-oracle', activeOpenOracleView: 'browse' }, title: 'Open Oracle' },
			{ input: { ...baseInput, route: 'open-oracle', activeOpenOracleView: 'create' }, title: 'Create Open Oracle Report' },
			{ input: { ...baseInput, route: 'open-oracle', activeOpenOracleView: 'selected-report' }, title: 'Open Oracle Report Details' },
			{ input: { ...baseInput, route: 'not-found' }, title: 'Page Not Found' },
		]

		for (const { input, title } of cases) {
			expect(getAppPageTitle(input)).toBe(title)
		}
	})

	test('renders the hidden page heading and updates the document title', async () => {
		const renderedComponent = await renderIntoDocument(<AppPageHeading pageTitle='Security Pools' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.title).toBe(formatAppDocumentTitle('Security Pools'))
		const heading = within(document.body).getByRole('heading', { level: 1, name: 'Security Pools' })
		expect(heading.classList.contains('visually-hidden')).toBe(true)
	})

	test('moves focus and resets the content scroll position after a forward route transition', async () => {
		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
		let scrollIntoViewCalls = 0
		HTMLElement.prototype.scrollIntoView = () => {
			scrollIntoViewCalls += 1
		}

		try {
			const renderedComponent = await renderIntoDocument(
				<>
					<AppPageHeading pageTitle='Security Pools' />
					<div id='app-content'>Pool content</div>
				</>,
			)
			cleanupRenderedComponent = renderedComponent.cleanup

			await act(() => {
				render(
					<>
						<AppPageHeading pageTitle='Create Security Pool' />
						<div id='app-content'>Create pool content</div>
					</>,
					renderedComponent.container,
				)
			})

			const heading = within(document.body).getByRole('heading', { level: 1, name: 'Create Security Pool' })
			expect(document.activeElement).toBe(heading)
			expect(heading.getAttribute('tabindex')).toBe('-1')
			expect(scrollIntoViewCalls).toBe(1)
		} finally {
			HTMLElement.prototype.scrollIntoView = originalScrollIntoView
		}
	})

	test('does not let same-title history navigation suppress a later forward route scroll', async () => {
		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
		let scrollIntoViewCalls = 0
		HTMLElement.prototype.scrollIntoView = () => {
			scrollIntoViewCalls += 1
		}

		try {
			window.history.replaceState({}, '', '#/security-pools?selectedPoolView=vaults')
			const renderedComponent = await renderIntoDocument(
				<>
					<AppPageHeading pageTitle='Manage Security Pool' />
					<div id='app-content'>Pool content</div>
				</>,
			)
			cleanupRenderedComponent = renderedComponent.cleanup

			window.history.pushState({}, '', '#/security-pools?selectedPoolView=reporting')
			window.dispatchEvent(new Event('popstate'))
			await act(() => {
				render(
					<>
						<AppPageHeading pageTitle='Manage Security Pool' />
						<div id='app-content'>Reporting content</div>
					</>,
					renderedComponent.container,
				)
			})

			window.history.pushState({}, '', '#/open-oracle')
			await act(() => {
				render(
					<>
						<AppPageHeading pageTitle='Open Oracle' />
						<div id='app-content'>Oracle content</div>
					</>,
					renderedComponent.container,
				)
			})

			const heading = within(document.body).getByRole('heading', { level: 1, name: 'Open Oracle' })
			expect(document.activeElement).toBe(heading)
			expect(scrollIntoViewCalls).toBe(1)
		} finally {
			HTMLElement.prototype.scrollIntoView = originalScrollIntoView
		}
	})
})
