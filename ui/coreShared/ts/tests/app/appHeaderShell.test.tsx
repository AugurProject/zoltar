/// <reference types="bun-types" />

import { describe, expect, mock, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { AppHeaderShell } from '../../app/components/AppHeaderShell.js'
import type { SimulationController } from '../../simulation/controller.js'

import { fireEvent, waitFor, within } from '../testUtils/queries'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { installTestRouting } from '../testUtils/testRouting.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

function createSimulationController(): SimulationController {
	const selectedAccount = '0x00000000000000000000000000000000000000a1' as Address
	return {
		accounts: [selectedAccount],
		advanceTime: async () => undefined,
		bootstrapError: undefined,
		bootstrapLabel: undefined,
		bootstrapProgress: undefined,
		blockCountSinceReset: 0n,
		currentScenario: 'baseline',
		currentTimestamp: 1n,
		dispose: async () => undefined,
		exportState: async () => '{}',
		isActive: true,
		isBootstrapped: true,
		isBootstrapping: false,
		mineBlock: async () => undefined,
		mintRep: async () => undefined,
		queryDelayMilliseconds: 0,
		repPerEthPrice: 10n ** 18n,
		repPerUsdcPrice: 10n ** 6n,
		reset: async () => undefined,
		selectAccount: async () => undefined,
		selectedAccount,
		setQueryDelayMilliseconds: async () => undefined,
		setRepPerEthPrice: async () => undefined,
		setRepPerUsdcPrice: async () => undefined,
		setTransactionDelayMilliseconds: async () => undefined,
		simulationSource: {
			kind: 'scenario',
			scenario: 'baseline',
		},
		subscribe: () => () => undefined,
		transactionCountSinceReset: 0n,
		transactionDelayMilliseconds: 0,
		waitUntilReady: async () => undefined,
	}
}

describe('AppHeaderShell', () => {
	test('always shows a skip link and focuses app content without changing the hash', async () => {
		installTestRouting()
		const domEnvironment = installDomEnvironment('http://localhost/#/zoltar?simulate=1')
		const appContent = document.createElement('main')
		appContent.id = 'app-content'
		appContent.tabIndex = -1
		document.body.appendChild(appContent)

		const overview = <div>Overview</div>
		const tabNavigation = { onRouteChange: () => undefined, route: 'zoltar', tabs: [{ hash: '#/zoltar', label: 'Zoltar', route: 'zoltar' }] }
		const onRefresh = mock(async () => undefined)
		const withoutSimulation = await renderIntoDocument(<AppHeaderShell overview={overview} simulationController={undefined} tabNavigation={tabNavigation} onRefresh={onRefresh} />)

		try {
			const skipLink = within(withoutSimulation.container).getByRole('button', { name: 'Skip to main content' })
			fireEvent.click(skipLink)
			expect(document.activeElement).toBe(appContent)
		} finally {
			await withoutSimulation.cleanup()
		}

		const beforeHash = domEnvironment.window.location.hash
		const withSimulation = await renderIntoDocument(<AppHeaderShell overview={overview} simulationController={createSimulationController()} tabNavigation={tabNavigation} onRefresh={onRefresh} />)

		try {
			const skipLink = within(withSimulation.container).getByRole('button', { name: 'Skip to main content' })
			fireEvent.click(skipLink)

			expect(document.activeElement).toBe(appContent)
			expect(domEnvironment.window.location.hash).toBe(beforeHash)
		} finally {
			await withSimulation.cleanup()
			appContent.remove()
			domEnvironment.cleanup()
		}
	})

	test('renders secondary views only while the current route is a primary tab', async () => {
		installTestRouting()
		const domEnvironment = installDomEnvironment('http://localhost/#/zoltar')
		const tabs = [
			{ hash: '#/deploy', label: 'Deploy', route: 'deploy' },
			{ hash: '#/zoltar', label: 'Zoltar', route: 'zoltar' },
		]
		const secondaryNavigation = { ariaLabel: 'Zoltar views', onChange: () => undefined, options: [{ href: '#/zoltar?zoltarView=questions', label: 'Browse Questions', value: 'questions' }], value: 'questions' }
		for (const [route, expectSecondary] of [
			['zoltar', true],
			['deploy', true],
			['not-found', false],
		] as const) {
			const rendered = await renderIntoDocument(<AppHeaderShell overview={<div>Overview</div>} secondaryNavigation={secondaryNavigation} simulationController={undefined} tabNavigation={{ onRouteChange: () => undefined, route, tabs }} onRefresh={async () => undefined} />)
			try {
				expect(within(rendered.container).queryByRole('navigation', { name: 'Zoltar views' }) !== null).toBe(expectSecondary)
			} finally {
				await rendered.cleanup()
			}
		}
		domEnvironment.cleanup()
	})

	test('omits the navigation stack and moves the guide link after the tiers', async () => {
		installTestRouting()
		const domEnvironment = installDomEnvironment('http://localhost/#/zoltar')
		const singleTab = await renderIntoDocument(
			<AppHeaderShell overview={<div>Overview</div>} simulationController={undefined} tabNavigation={{ onRouteChange: () => undefined, route: 'zoltar', showProtocolGuide: false, tabs: [{ hash: '#/zoltar', label: 'Zoltar', route: 'zoltar' }] }} onRefresh={async () => undefined} />,
		)
		try {
			expect(singleTab.container.querySelector('.app-nav-stack')).toBeNull()
		} finally {
			await singleTab.cleanup()
		}
		const secondaryNavigation = { ariaLabel: 'Security Pools views', onChange: () => undefined, options: [{ href: '#/security-pools', label: 'Browse Pools', value: 'browse' }], value: 'browse' }
		const withGuide = await renderIntoDocument(
			<AppHeaderShell
				overview={<div>Overview</div>}
				secondaryNavigation={secondaryNavigation}
				simulationController={undefined}
				tabNavigation={{
					onRouteChange: () => undefined,
					route: 'security-pools',
					tabs: [
						{ hash: '#/security-pools', label: 'Security Pools', route: 'security-pools' },
						{ hash: '#/open-oracle', label: 'Open Oracle', route: 'open-oracle' },
					],
				}}
				onRefresh={async () => undefined}
			/>,
		)
		try {
			const stack = withGuide.container.querySelector('.app-nav-stack')
			if (stack === null) throw new Error('Navigation stack is missing')
			const children = Array.from(stack.children).map(child => child.className.split(' ')[0])
			expect(children).toEqual(['tab-nav', 'route-subnav-region', 'protocol-guide-link'])
			expect(stack.querySelector('.tab-nav .protocol-guide-link')).toBeNull()
		} finally {
			await withGuide.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('supports an injected application header and custom main-content target', async () => {
		const domEnvironment = installDomEnvironment('http://localhost/#/markets')
		const appContent = document.createElement('main')
		appContent.id = 'main-content'
		document.body.appendChild(appContent)
		const rendered = await renderIntoDocument(<AppHeaderShell mainElementId='main-content' renderHeader={simulationBanner => <header>{simulationBanner}Trading navigation</header>} simulationController={undefined} onRefresh={async () => undefined} />)

		try {
			expect(rendered.container.textContent).toContain('Trading navigation')
			fireEvent.click(within(rendered.container).getByRole('button', { name: 'Skip to main content' }))
			expect(document.activeElement).toBe(appContent)
		} finally {
			await rendered.cleanup()
			appContent.remove()
			domEnvironment.cleanup()
		}
	})

	test('moves focus into settings and restores it when Escape closes the dialog', async () => {
		const domEnvironment = installDomEnvironment('http://localhost/#/markets')
		const rendered = await renderIntoDocument(<AppHeaderShell overview={<div>Overview</div>} simulationController={undefined} onRefresh={async () => undefined} />)
		try {
			const settingsButton = within(rendered.container).getByRole('button', { name: 'Settings' })
			fireEvent.click(settingsButton)
			const networkSelect = within(rendered.container).getByRole('combobox', { name: 'RPC network' })
			await waitFor(() => expect(document.activeElement).toBe(networkSelect))
			fireEvent.keyDown(document, { key: 'Escape' })
			await waitFor(() => expect(within(rendered.container).queryByRole('dialog')).toBeNull())
			expect(document.activeElement).toBe(settingsButton)
		} finally {
			await rendered.cleanup()
			domEnvironment.cleanup()
		}
	})
})
