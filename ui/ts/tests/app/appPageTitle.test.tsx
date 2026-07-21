/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '../testUtils/queries'
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
			{ input: { ...baseInput, route: 'open-oracle', activeOpenOracleView: 'browse' }, title: 'Oracle Reports' },
			{ input: { ...baseInput, route: 'open-oracle', activeOpenOracleView: 'create' }, title: 'Create Oracle Report' },
			{ input: { ...baseInput, route: 'open-oracle', activeOpenOracleView: 'selected-report' }, title: 'Oracle Report Details' },
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
})
