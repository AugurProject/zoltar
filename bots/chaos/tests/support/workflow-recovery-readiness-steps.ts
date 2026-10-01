import { expect } from 'bun:test'
import { walletAddress } from './dashboard-harness.ts'
import { degradedWorkflowRenderingState, pausedWorkflowRenderingState, rpcSecret, staleSubmissionWorkflowRenderingState, workflowRenderingState } from './dashboard-workflow-fixtures.ts'
import type { WorkflowRecoveryContext, WorkflowViewport } from './workflow-recovery-harness.ts'

// Staged checks of the workflow-recovery dashboard test: degraded readiness, the resume dialog, and the mobile settings and navigation layout.

/** Degraded RPC health, stale submission evidence, and an unconfigured submission path. */
export async function verifyDegradedSubmissionReadiness(context: WorkflowRecoveryContext, viewport: WorkflowViewport) {
	const { cdp, dashboard, fixture, waitFor } = context
	fixture.initialDashboardState = degradedWorkflowRenderingState
	fixture.recoveredDashboardState = degradedWorkflowRenderingState
	fixture.stateRequests = 0
	await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
	await waitFor("document.querySelector('#rpc-health-status')?.textContent === 'Quorum blocked'", `${viewport.label} degraded RPC health did not render`)
	expect(
		await cdp.evaluate(`({
			chain: document.querySelector('#rpc-chain-readiness')?.textContent,
			healthy: document.querySelector('#rpc-healthy-count')?.textContent,
			secretVisible: document.documentElement.textContent?.includes(${JSON.stringify(rpcSecret)}),
			status: document.querySelector('#rpc-health-status')?.textContent,
		})`),
	).toEqual({ chain: 'Not ready for chain 11155111', healthy: '1 of 3', secretVisible: false, status: 'Quorum blocked' })
	expect(
		await cdp.evaluate(`({
			healthy: document.querySelector('#submission-healthy-count')?.textContent,
			proof: document.querySelector('#submission-signer-proof')?.textContent,
			status: document.querySelector('#submission-health-status')?.textContent,
		})`),
	).toEqual({ healthy: '1 of 3 origins', proof: 'Does not match current signer', status: 'Path blocked' })
	expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)

	fixture.initialDashboardState = staleSubmissionWorkflowRenderingState
	fixture.recoveredDashboardState = staleSubmissionWorkflowRenderingState
	fixture.stateRequests = 0
	await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
	await waitFor("document.querySelector('#submission-health-status')?.textContent === 'Evidence stale'", `${viewport.label} stale submission evidence did not render`)
	expect(
		await cdp.evaluate(`({
			freshness: document.querySelector('#submission-freshness')?.textContent,
			healthy: document.querySelector('#submission-healthy-count')?.textContent,
			proof: document.querySelector('#submission-signer-proof')?.textContent,
			status: document.querySelector('#submission-health-status')?.textContent,
		})`),
	).toEqual({ freshness: '0 fresh of 3 checked', healthy: '0 of 3 origins', proof: 'Not yet proven', status: 'Evidence stale' })

	fixture.submissionConfigured = false
	fixture.stateRequests = 0
	await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
	await waitFor("document.querySelector('#submission-health-status')?.textContent === 'Path not configured'", `${viewport.label} unconfigured submission path did not render`)
	expect(
		await cdp.evaluate(`({
			freshness: document.querySelector('#submission-freshness')?.textContent,
			mode: document.querySelector('#submission-mode')?.textContent,
			status: document.querySelector('#submission-health-status')?.textContent,
		})`),
	).toEqual({ freshness: 'Not yet verified', mode: '—', status: 'Path not configured' })
	fixture.submissionConfigured = true
}

/** The resume dialog reports canary and unrestricted random-novelty scope with an accessible action order. */
export async function verifyResumeScope(context: WorkflowRecoveryContext, viewport: WorkflowViewport) {
	const { accessibilityIdentity, cdp, dashboard, expectVisibleIdentifiers, fixture, waitFor } = context
	fixture.initialDashboardState = pausedWorkflowRenderingState
	fixture.recoveredDashboardState = pausedWorkflowRenderingState
	fixture.stateRequests = 0
	fixture.selectableOperationAllowlist = ['open-oracle.blocked-sibling', 'trading.position.enter']
	await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
	await waitFor("document.querySelector('#mode-badge')?.textContent === 'Dry run'", `${viewport.label} paused resume fixture did not render`)
	await cdp.evaluate("document.querySelector('#pause-button')?.click()")
	await waitFor("document.querySelector('#resume-dialog')?.open === true", `${viewport.label} resume dialog did not open`)
	expect(await accessibilityIdentity('#resume-dialog')).toEqual({ name: 'Resume chaos scheduling?', role: 'dialog' })
	expect(
		await cdp.evaluate(`(() => {
			const scope = [...document.querySelectorAll('#resume-preflight li')].find(row => row.querySelector('span')?.textContent === 'Random novelty scope')
			return {
				ids: scope?.querySelector('.resume-random-scope-ids')?.textContent,
				summary: scope?.querySelector('.resume-random-scope > span')?.textContent,
				warningHidden: document.querySelector('#resume-random-scope-warning')?.classList.contains('hidden'),
			}
		})()`),
	).toEqual({ ids: 'open-oracle.blocked-sibling\ntrading.position.enter', summary: '2-ID canary', warningHidden: true })
	await cdp.evaluate("document.querySelector('#cancel-resume')?.click()")
	fixture.selectableOperationAllowlist = null
	await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
	await waitFor("document.querySelector('#mode-badge')?.textContent === 'Dry run'", `${viewport.label} unrestricted resume fixture did not render`)
	await cdp.evaluate("document.querySelector('#pause-button')?.click()")
	await waitFor("document.querySelector('#resume-dialog')?.open === true", `${viewport.label} unrestricted resume dialog did not open`)
	expect(
		await cdp.evaluate(`(() => {
			const scope = [...document.querySelectorAll('#resume-preflight li')].find(row => row.querySelector('span')?.textContent === 'Random novelty scope')
			return {
				button: document.querySelector('#confirm-resume')?.textContent,
				disabled: document.querySelector('#confirm-resume')?.disabled,
				scope: scope?.querySelector('strong')?.textContent,
				warning: document.querySelector('#resume-random-scope-warning')?.textContent,
			}
		})()`),
	).toEqual({ button: 'Resume unrestricted bot', disabled: false, scope: 'ALL selectable operations', warning: 'Random novelty is unrestricted. Any due eligible selectable operation may run immediately after resume.' })
	expect(
		await cdp.evaluate(`(() => {
			const actions = [...document.querySelectorAll('#resume-dialog .dialog-actions button')]
			const visualOrder = [...actions].sort((left, right) => {
				const leftBounds = left.getBoundingClientRect()
				const rightBounds = right.getBoundingClientRect()
				return Math.abs(leftBounds.top - rightBounds.top) > 1 ? leftBounds.top - rightBounds.top : leftBounds.left - rightBounds.left
			})
			return {
				active: document.activeElement?.id,
				domOrder: actions.map(action => action.id),
				visualOrder: visualOrder.map(action => action.id),
			}
		})()`),
	).toEqual({ active: 'cancel-resume', domOrder: ['cancel-resume', 'confirm-resume'], visualOrder: ['cancel-resume', 'confirm-resume'] })
	await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', nativeVirtualKeyCode: 9, type: 'rawKeyDown', windowsVirtualKeyCode: 9 })
	await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', nativeVirtualKeyCode: 9, type: 'keyUp', windowsVirtualKeyCode: 9 })
	expect(await cdp.evaluate('document.activeElement?.id')).toBe('confirm-resume')
	await expectVisibleIdentifiers([{ type: 'recovery signer address', value: walletAddress }], viewport.width === 390 ? 44 : 32, '#resume-dialog .full-identifier')
	await cdp.evaluate("document.querySelector('#cancel-resume')?.click()")
	fixture.initialDashboardState = workflowRenderingState
	fixture.recoveredDashboardState = workflowRenderingState
}

/** Mobile settings checkbox targets and the connectivity form fit the viewport. */
export async function verifyMobileSettingsLayout(context: WorkflowRecoveryContext) {
	const { cdp, dashboard, fixture, waitFor } = context
	await cdp.command('Page.navigate', { url: 'about:blank' })
	await waitFor("document.readyState === 'complete'", 'Chromium did not reset before the settings layout check')
	fixture.stateRequests = 3
	await cdp.command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: 844, mobile: false, width: 390 })
	await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
	await waitFor("document.querySelector('#settings-scope')?.textContent === 'sepolia · chain 11155111'", 'Mobile settings fixture did not load')
	const checkboxTargets = await cdp.evaluate(`[
		...document.querySelectorAll('#execution-enabled, #allow-high-risk, #allow-irreversible, [data-ecosystem-toggle], #remember-signer'),
	].map(input => {
		const label = input.closest('.switch-field') ?? input.labels?.[0]
		const bounds = label?.getBoundingClientRect()
		return { height: bounds?.height, name: input.id || input.dataset.ecosystemToggle, width: bounds?.width }
	})`)
	expect(checkboxTargets).toHaveLength(8)
	for (const target of Array.isArray(checkboxTargets) ? checkboxTargets : []) {
		expect(Reflect.get(target, 'width'), `${String(Reflect.get(target, 'name'))} label width`).toBeGreaterThanOrEqual(44)
		expect(Reflect.get(target, 'height'), `${String(Reflect.get(target, 'name'))} label height`).toBeGreaterThanOrEqual(44)
	}
	const connectivityLayout = await cdp.evaluate(`(() => {
		const form = document.querySelector('#connectivity-form')
		const button = document.querySelector('#save-connectivity')
		if (!(form instanceof HTMLFormElement) || !(button instanceof HTMLButtonElement)) return undefined
		const formBounds = form.getBoundingClientRect()
		const buttonBounds = button.getBoundingClientRect()
		return { buttonHeight: buttonBounds.height, formLeft: formBounds.left, formRight: formBounds.right, viewportWidth: document.documentElement.clientWidth }
	})()`)
	const formLeft = Reflect.get(Object(connectivityLayout), 'formLeft')
	const formRight = Reflect.get(Object(connectivityLayout), 'formRight')
	const viewportWidth = Reflect.get(Object(connectivityLayout), 'viewportWidth')
	const buttonHeight = Reflect.get(Object(connectivityLayout), 'buttonHeight')
	if (typeof formLeft !== 'number' || typeof formRight !== 'number' || typeof viewportWidth !== 'number' || typeof buttonHeight !== 'number') throw new Error('Mobile connectivity form bounds are unavailable')
	expect(formLeft).toBeGreaterThanOrEqual(0)
	expect(formRight).toBeLessThanOrEqual(viewportWidth)
	expect(buttonHeight).toBeGreaterThanOrEqual(44)
}

/** The section navigation keeps the current chip visible across refreshes and moves aria-current on in-page navigation. */
export async function verifySectionNavigation(context: WorkflowRecoveryContext) {
	const { cdp, dashboard, fixture, waitFor } = context
	for (const route of ['ecosystem', 'settings']) {
		await cdp.command('Page.navigate', { url: 'about:blank' })
		await waitFor("document.readyState === 'complete'", `Chromium did not reset before the /${route} navigation check`)
		fixture.stateRequests = 0
		await cdp.command('Page.navigate', { url: new URL(`/${route}`, dashboard.url).href })
		await waitFor(
			`(() => {
			const navigation = document.querySelector('.section-nav')
			const current = navigation?.querySelector('[aria-current="page"]')
			if (!(navigation instanceof HTMLElement) || !(current instanceof HTMLElement)) return false
			const navigationBounds = navigation.getBoundingClientRect()
			const currentBounds = current.getBoundingClientRect()
			return currentBounds.left >= navigationBounds.left - 1 && currentBounds.right <= navigationBounds.right + 1
		})()`,
			`/${route} did not reveal its current navigation chip`,
		)
		await waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false", `/${route} initial refresh did not settle`)
		const navigationBeforeRefresh = await cdp.evaluate(`(() => {
			const navigation = document.querySelector('.section-nav')
			const current = navigation?.querySelector('[aria-current="page"]')
			if (!(navigation instanceof HTMLElement) || !(current instanceof HTMLElement)) return undefined
			const navigationBounds = navigation.getBoundingClientRect()
			const currentBounds = current.getBoundingClientRect()
			return {
				bodyWidth: document.body.scrollWidth,
				centerDelta: Math.abs((currentBounds.left + currentBounds.right) / 2 - (navigationBounds.left + navigationBounds.right) / 2),
				clientWidth: document.documentElement.clientWidth,
				currentPath: new URL(current.getAttribute('href') ?? '', window.location.href).pathname,
				currentVisible: currentBounds.left >= navigationBounds.left - 1 && currentBounds.right <= navigationBounds.right + 1,
				linkHeights: [...navigation.querySelectorAll('a')].map(link => link.getBoundingClientRect().height),
				maximumScrollLeft: navigation.scrollWidth - navigation.clientWidth,
				scrollLeft: navigation.scrollLeft,
				scrollY: window.scrollY,
			}
		})()`)
		expect(navigationBeforeRefresh).toMatchObject({ currentPath: `/${route}`, currentVisible: true, scrollY: 0 })
		expect(Reflect.get(Object(navigationBeforeRefresh), 'bodyWidth')).toBe(Reflect.get(Object(navigationBeforeRefresh), 'clientWidth'))
		const navigationScrollLeft = Reflect.get(Object(navigationBeforeRefresh), 'scrollLeft')
		const maximumScrollLeft = Reflect.get(Object(navigationBeforeRefresh), 'maximumScrollLeft')
		if (typeof navigationScrollLeft !== 'number' || typeof maximumScrollLeft !== 'number') throw new Error(`/${route} navigation scroll metrics are unavailable`)
		if (route === 'ecosystem') {
			expect(navigationScrollLeft).toBeGreaterThan(0)
			expect(navigationScrollLeft).toBeLessThan(maximumScrollLeft)
			expect(Reflect.get(Object(navigationBeforeRefresh), 'centerDelta')).toBeLessThanOrEqual(1)
		} else expect(Math.abs(navigationScrollLeft - maximumScrollLeft)).toBeLessThanOrEqual(1)
		const linkHeights = Reflect.get(Object(navigationBeforeRefresh), 'linkHeights')
		expect(linkHeights).toHaveLength(6)
		for (const height of Array.isArray(linkHeights) ? linkHeights : []) expect(height).toBeGreaterThanOrEqual(44)
		const requestsBeforeRefresh = fixture.stateRequests
		await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
		for (let attempt = 0; attempt < 100 && fixture.stateRequests === requestsBeforeRefresh; attempt += 1) await Bun.sleep(10)
		expect(fixture.stateRequests).toBeGreaterThan(requestsBeforeRefresh)
		const navigationAfterRefresh = await cdp.evaluate(`({
			scrollLeft: document.querySelector('.section-nav')?.scrollLeft,
			scrollY: window.scrollY,
		})`)
		expect(navigationAfterRefresh).toEqual({ scrollLeft: Reflect.get(Object(navigationBeforeRefresh), 'scrollLeft'), scrollY: Reflect.get(Object(navigationBeforeRefresh), 'scrollY') })
	}
	// In-page navigation must move the `aria-current="page"` marker the stylesheet and
	// assistive technology key on, not just an empty `aria-current` attribute.
	for (const route of ['ecosystem', 'settings']) {
		await cdp.evaluate(`document.querySelector('.section-nav a[href="/${route}"]')?.click()`)
		await waitFor(`document.body.dataset.page === '${route}'`, `Clicking the /${route} link did not switch the page`)
		const currentLinks = await cdp.evaluate("[...document.querySelectorAll('.section-nav a')].filter(link => link.hasAttribute('aria-current')).map(link => [new URL(link.href).pathname, link.getAttribute('aria-current')])")
		expect(currentLinks).toEqual([[`/${route}`, 'page']])
	}
}
