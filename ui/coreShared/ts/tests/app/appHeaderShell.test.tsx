/// <reference types="bun-types" />

import { describe, expect, mock, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { AppHeaderShell } from '../../app/components/AppHeaderShell.js'
import { ProtocolAppFrame } from '../../app/components/ProtocolAppFrame.js'
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
		advanceBlock: async () => undefined,
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
		setWalletMode: async () => undefined,
		walletMode: 'connected',
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
		const secondaryNavigation = { ariaLabel: 'Zoltar views', onChange: () => undefined, options: [{ href: '#/zoltar?zoltarView=questions', label: 'Browse questions', value: 'questions' }], value: 'questions' }
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

	test("promotes a single section's views into the top bar instead of stacking a second tab row", async () => {
		installTestRouting()
		const domEnvironment = installDomEnvironment('http://localhost/#/zoltar')
		const secondaryNavigation = {
			ariaLabel: 'Zoltar views',
			onChange: () => undefined,
			options: [
				{ href: '#/zoltar?zoltarView=questions', label: 'Browse questions', value: 'questions' },
				{ href: '#/zoltar?zoltarView=create', label: 'Create question', value: 'create' },
			],
			value: 'questions',
		}
		const singleTab = await renderIntoDocument(
			<AppHeaderShell
				overview={<div>Overview</div>}
				secondaryNavigation={secondaryNavigation}
				simulationController={undefined}
				tabNavigation={{ onRouteChange: () => undefined, route: 'zoltar', showProtocolGuide: false, tabs: [{ hash: '#/zoltar', label: 'Zoltar', route: 'zoltar' }] }}
				onRefresh={async () => undefined}
			/>,
		)
		try {
			const navigation = within(singleTab.container).getByRole('navigation', { name: 'Zoltar views' })
			expect(navigation.closest('.header-toolbar-navigation')).not.toBeNull()
			expect(within(navigation).getByRole('link', { name: 'Browse questions' }).getAttribute('aria-current')).toBe('page')
			expect(singleTab.container.querySelector('.route-subnav-region')).toBeNull()
			expect(within(singleTab.container).queryByRole('navigation', { name: 'Application sections' })).toBeNull()
		} finally {
			await singleTab.cleanup()
			domEnvironment.cleanup()
		}
	})

	test('keeps primary sections in the top bar, section views in one segmented row, and the guide in settings', async () => {
		installTestRouting()
		const domEnvironment = installDomEnvironment('http://localhost/#/security-pools')
		const secondaryNavigation = { ariaLabel: 'Security pools views', onChange: () => undefined, options: [{ href: '#/security-pools', label: 'Browse pools', value: 'browse' }], value: 'browse' }
		const withGuide = await renderIntoDocument(
			<AppHeaderShell
				overview={<div>Overview</div>}
				secondaryNavigation={secondaryNavigation}
				simulationController={undefined}
				tabNavigation={{
					onRouteChange: () => undefined,
					route: 'security-pools',
					tabs: [
						{ hash: '#/security-pools', label: 'Security pools', route: 'security-pools' },
						{ hash: '#/open-oracle', label: 'OpenOracle', route: 'open-oracle' },
					],
				}}
				onRefresh={async () => undefined}
			/>,
		)
		try {
			const queries = within(withGuide.container)
			expect(queries.getByRole('navigation', { name: 'Application sections' }).closest('.header-toolbar-navigation')).not.toBeNull()
			const views = queries.getByRole('navigation', { name: 'Security pools views' })
			expect(views.closest('.app-chrome')).toBeNull()
			expect(views.querySelector('.view-tabs.segmented')).not.toBeNull()
			expect(queries.queryByRole('link', { name: 'Protocol guide' })).toBeNull()
			fireEvent.click(queries.getByRole('button', { name: 'Settings' }))
			expect(
				within(queries.getByRole('dialog', { name: 'Application settings' }))
					.getByRole('link', { name: 'Protocol guide' })
					.getAttribute('href'),
			).toBe('https://augurproject.github.io/zoltar/docs/documentation.html')
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

describe('ProtocolAppFrame', () => {
	test('keeps the header first, notices below it, and the page heading at the start of the content', async () => {
		const domEnvironment = installDomEnvironment('http://localhost/#/zoltar')
		const rendered = await renderIntoDocument(
			<ProtocolAppFrame accountAddress={undefined} currentBlockNumber={undefined} currentTimestamp={undefined} header={<header id='frame-header'>Header</header>} heading={<h1 id='frame-heading'>Page</h1>} notices={<div id='frame-notices'>Notices</div>} routeContentDisabled={false} transactionRouteKey='zoltar'>
				<p id='frame-content'>Content</p>
			</ProtocolAppFrame>,
		)
		try {
			const main = rendered.container.querySelector('main')
			if (main === null) throw new Error('Expected the main landmark')
			// A notice appearing or clearing must not move the header's controls, so notices follow the header.
			expect(Array.from(main.children, child => child.id)).toEqual(['frame-header', 'frame-notices', 'app-content'])
			// Focus moved to the heading on a page change continues into the content with the next Tab.
			const appContent = document.getElementById('app-content')
			expect(appContent?.firstElementChild?.id).toBe('frame-heading')
			expect(appContent?.querySelector('#frame-content')).not.toBeNull()
		} finally {
			await rendered.cleanup()
			domEnvironment.cleanup()
		}
	})
})
