import { installTradingRouting } from '../../lib/routing.js'
import { beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { App, currentRoute, tradingDocumentTitle } from '../../app/App.js'
import { UniverseSelector } from '../../components/UniverseSelector.js'
import { WalletSummary } from '../../components/WalletSummary.js'
import { buildLiveUniverseOptions, compactUniqueUniverseIds } from '../../lib/universeOptions.js'
import { routeOwnsLiveWallet, walletSummaryAfterRouteChange, walletSummaryForUniverse } from '../../lib/walletSummaryState.js'
import { filterMarketsByUniverse, observeKnownReceipt, walletSummaryAvailability, walletSummaryDiscoveryRetryStart, walletSummaryRefreshState } from '../../features/liveTradingControllerHelpers.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { LiveMarket } from '../../protocol/live.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

beforeEach(() => installTradingRouting())

describe('universe selector', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: 'http://localhost/#/markets',
	})

	test('selects one universe from the top-level control', async () => {
		let selected = '1'
		const rendered = await renderIntoDocument(
			<UniverseSelector
				options={[
					{ id: '1', label: 'Genesis universe' },
					{ id: '2', label: 'Universe 2 · YES branch' },
				]}
				selectedId={selected}
				disabled={false}
				onChange={next => {
					selected = next
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		const select = rendered.container.querySelector<HTMLSelectElement>('select')
		expect(select?.tagName).toBe('SELECT')
		expect(select?.getAttribute('aria-label')).toBe('Select universe')
		expect(rendered.container.querySelector('.universe-selector > span')).toBeNull()
		expect(Array.from(select?.options ?? [], option => option.textContent)).toEqual(['Genesis universe', 'Universe 2 · YES branch'])
		expect(select?.value).toBe('1')
		await act(() => {
			if (select === null) throw new Error('Universe selector is unavailable')
			select.value = '2'
			select.dispatchEvent(new Event('change', { bubbles: true }))
		})
		expect(selected).toBe('2')
	})

	test('renders an explicit not-found route and updates the document title', async () => {
		window.history.replaceState(undefined, '', '/#/missing')
		expect(currentRoute()).toBe('not-found')
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('main')?.textContent).toContain('Page not found')
		expect(rendered.container.querySelector('h1.visually-hidden')?.textContent).toBe('Not found')
		const skipButton = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent === 'Skip to main content')
		if (skipButton === undefined) throw new Error('Shared application skip control is unavailable')
		await act(() => skipButton.click())
		expect(document.activeElement).toBe(rendered.container.querySelector('main'))
		expect(document.title).toBe(tradingDocumentTitle('not-found'))
		expect(document.title).toBe('Not found · Statoblast trading')
	})

	test('accepts only addressed security-pool routes', () => {
		window.history.replaceState(undefined, '', '/#/security-pool')
		expect(currentRoute()).toBe('not-found')
		const address = `0x${'44'.repeat(20)}`
		window.history.replaceState(undefined, '', `/#/security-pool/${address}`)
		expect(currentRoute()).toBe(`security-pool/${address}`)
		window.history.replaceState(undefined, '', `/#security-pool/${address}`)
		expect(currentRoute()).toBe(`security-pool/${address}`)
	})

	test('preserves slashless top-level route bookmarks', () => {
		window.history.replaceState(undefined, '', '/#markets')
		expect(currentRoute()).toBe('markets')
	})

	test('uses Statoblast branding without the removed footer disclaimers', async () => {
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.application-brand')?.textContent).toContain('Statoblast trading')
		expect(rendered.container.querySelector('footer')).toBeNull()
		expect(rendered.container.textContent).not.toContain('unaudited MVP')
		expect(rendered.container.textContent).not.toContain('Spot prices are not manipulation-resistant oracles.')
	})

	test('connects wallets from the persistent top-right header action', async () => {
		window.history.replaceState(undefined, '', '/#/markets')
		const configuration: DeploymentConfiguration = {
			chainId: 31_337,
			chainName: 'Local',
			rpcUrl: 'http://127.0.0.1:1',
			securityPoolFactory: `0x${'11'.repeat(20)}`,
			factory: `0x${'22'.repeat(20)}`,
			router: `0x${'33'.repeat(20)}`,
			feeBps: 30,
		}
		const rendered = await renderIntoDocument(<App loadLiveDeployment={async () => configuration} />)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(10)
		})
		const walletButton = rendered.container.querySelector<HTMLButtonElement>('.trading-wallet-actions .wallet-button')
		expect(walletButton?.textContent).toBe('Connect wallet')
		expect(walletButton?.disabled).toBeFalse()
		expect(rendered.container.querySelector('main .route-header .wallet-button')).toBeNull()
		await act(async () => {
			walletButton?.click()
			await Bun.sleep(10)
		})
		expect(rendered.container.querySelector('main')?.textContent).toContain('No injected wallet was found')
	})

	test('uses shared overview and navigation with an accessible mobile route selector', async () => {
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.top-shell-content .overview-route-header .application-brand')?.textContent).toBe('Statoblast trading')
		expect(rendered.container.querySelector('.app-nav-stack .tab-nav')).not.toBeNull()
		const select = rendered.container.querySelector<HTMLSelectElement>('.mobile-route-select select')
		if (select === null) throw new Error('Shared mobile navigation is missing')
		await act(() => {
			select.value = 'help'
			select.dispatchEvent(new Event('change', { bubbles: true }))
		})
		expect(currentRoute()).toBe('help')
	})

	test('shows wallet connection failures on live security-pool routes', async () => {
		window.history.replaceState(undefined, '', `/#/security-pool/0x${'44'.repeat(20)}`)
		const configuration: DeploymentConfiguration = {
			chainId: 31_337,
			chainName: 'Local',
			rpcUrl: 'http://127.0.0.1:1',
			securityPoolFactory: `0x${'11'.repeat(20)}`,
			factory: `0x${'22'.repeat(20)}`,
			router: `0x${'33'.repeat(20)}`,
			feeBps: 30,
		}
		const rendered = await renderIntoDocument(<App loadLiveDeployment={async () => configuration} />)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(10)
		})
		const walletButton = rendered.container.querySelector<HTMLButtonElement>('.trading-wallet-actions .wallet-button')
		expect(walletButton?.textContent).toBe('Connect wallet')
		await act(async () => {
			walletButton?.click()
			await Bun.sleep(10)
		})
		expect(rendered.container.querySelector('main [role="alert"]')?.textContent).toContain('No injected wallet was found')
		await act(async () => {
			window.history.replaceState(undefined, '', '/#/markets')
			window.dispatchEvent(new Event('hashchange'))
			await Bun.sleep(10)
		})
		expect(rendered.container.querySelector('main')?.textContent).not.toContain('No injected wallet was found')
	})

	test('keeps only markets minted in the selected universe', () => {
		const first = { universeId: 1n } as LiveMarket
		const second = { universeId: 2n } as LiveMarket
		expect(filterMarketsByUniverse([first, second], '2')).toEqual([second])
		expect(filterMarketsByUniverse([first, second], undefined)).toEqual([])
	})

	test('labels live genesis and non-genesis universes without ambiguous compact IDs', () => {
		const firstCollision = 123_000_000_000_000_000_456n
		const secondCollision = 123_999_999_999_999_999_456n
		const options = buildLiveUniverseOptions([0n, 7n, firstCollision, secondCollision])
		expect(options[0]).toEqual({ id: '0', label: 'Genesis universe', accessibleLabel: 'Genesis universe' })
		expect(options[1]).toEqual({ id: '7', label: 'Universe 7', accessibleLabel: 'Universe 7' })
		expect(options[2]?.label).toStartWith('Universe ')
		expect(options[3]?.label).toStartWith('Universe ')
		expect(options[2]?.label).not.toBe(options[3]?.label)
		expect(options[2]?.accessibleLabel).toBe(`Universe ${firstCollision.toString()}`)
		expect(options[3]?.accessibleLabel).toBe(`Universe ${secondCollision.toString()}`)
		expect(() => compactUniqueUniverseIds(['7', '7'])).toThrow('Universe IDs must be unique')
	})

	test('keeps wallet balance failures visible without abbreviating the account', async () => {
		const account = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'
		let retries = 0
		const rendered = await renderIntoDocument(<WalletSummary summary={{ account, ethAttoEth: undefined, repAttoRep: undefined, status: 'error', error: 'REP balance RPC failed', errorLabel: 'Wallet balance read failed', universeId: '1' }} onRetry={() => retries++} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.overview-address-metric')?.textContent).toContain(account)
		expect(rendered.container.querySelector('[data-wallet-asset="ETH"]')?.textContent).toContain('—')
		expect(rendered.container.querySelector('[data-wallet-asset="REP"]')?.textContent).toContain('—')
		expect(rendered.container.querySelector('[role="alert"]')?.textContent).toBe('Wallet balance read failed')
		expect(rendered.container.querySelector('[role="alert"]')?.getAttribute('aria-label')).toContain('REP balance RPC failed')
		await act(() => rendered.container.querySelector<HTMLButtonElement>('.trading-wallet-error button')?.click())
		expect(retries).toBe(1)
	})

	test('ends wallet balance loading when selected-universe discovery fails', async () => {
		expect(walletSummaryAvailability(true, undefined, 'loading', undefined, true)?.status).toBe('loading')
		const availability = walletSummaryAvailability(true, undefined, 'error', 'RPC request failed', true)
		if (availability === undefined) throw new Error('A discovery failure must make wallet balances unavailable')
		const rendered = await renderIntoDocument(<WalletSummary summary={{ account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', ethAttoEth: undefined, repAttoRep: undefined, status: availability.status, error: availability.error, errorLabel: availability.errorLabel, universeId: '1' }} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.trading-wallet-summary')?.getAttribute('aria-busy')).toBe('false')
		expect(rendered.container.querySelector('[role="alert"]')?.getAttribute('aria-label')).toContain('SecurityPool discovery failed: RPC request failed')
	})

	test('discloses simulation balances through the shared overview control', async () => {
		const rendered = await renderIntoDocument(<WalletSummary simulation summary={{ account: '0x00000000000000000000000000000000000000A1', ethAttoEth: 1n, repAttoRep: 2n, status: 'ready', error: undefined, errorLabel: undefined, universeId: '0' }} />)
		cleanupRendered = rendered.cleanup
		const toggle = rendered.container.querySelector<HTMLButtonElement>('.overview-details-toggle')
		expect(toggle?.getAttribute('aria-expanded')).toBe('false')
		expect(rendered.container.querySelector('.mobile-expanded')).toBeNull()
		await act(() => toggle?.click())
		expect(toggle?.getAttribute('aria-expanded')).toBe('true')
		expect(rendered.container.querySelector('.overview-inline-metrics.mobile-expanded')).not.toBeNull()
		await act(() => toggle?.click())
		expect(toggle?.getAttribute('aria-expanded')).toBe('false')
	})

	test('preserves all 18 decimals in authoritative wallet balances', async () => {
		const rendered = await renderIntoDocument(<WalletSummary summary={{ account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', ethAttoEth: 1n, repAttoRep: 2n ** 256n - 1n, status: 'ready', error: undefined, errorLabel: undefined, universeId: '1' }} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[data-wallet-asset="ETH"] button')?.getAttribute('title')).toBe('0.000000000000000001 ETH')
		expect(rendered.container.querySelector('[data-wallet-asset="REP"] button')?.getAttribute('title')).toEndWith('.584007913129639935 REP')
	})

	test('hides retained balances synchronously when the selected universe changes', () => {
		const previous = { account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72' as const, ethAttoEth: 64n * 10n ** 18n, repAttoRep: 12_500n * 10n ** 18n, status: 'ready' as const, error: undefined, errorLabel: undefined, universeId: '1' }
		const invalidated = walletSummaryForUniverse(previous, '2')
		expect(invalidated).toEqual({ account: previous.account, ethAttoEth: undefined, repAttoRep: undefined, status: 'loading', error: undefined, errorLabel: undefined, universeId: '2' })
		expect(walletSummaryForUniverse(previous, '1')).toBe(previous)
	})

	test('drops wallet identity whenever live route ownership unmounts or remounts', () => {
		const previous = { account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72' as const, ethAttoEth: 64n * 10n ** 18n, repAttoRep: 12_500n * 10n ** 18n, status: 'ready' as const, error: undefined, errorLabel: undefined, universeId: '1' }
		const detached = walletSummaryAfterRouteChange(previous, 'markets', 'help', '1')
		expect(detached.account).toBeUndefined()
		expect(walletSummaryAfterRouteChange(previous, 'markets', 'not-found', '1').account).toBeUndefined()
		expect(routeOwnsLiveWallet('not-found')).toBeFalse()
		expect(walletSummaryAfterRouteChange(detached, 'help', 'markets', '1')).toEqual(detached)
		expect(walletSummaryAfterRouteChange(previous, 'markets', 'portfolio', '1')).toBe(previous)
	})

	test('clears header quantities for a known transaction receipt before reloading', () => {
		expect(walletSummaryRefreshState('0x8ba1f109551bD432803012645Ac136ddd64DBA72', '2')).toEqual({ account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', ethAttoEth: undefined, repAttoRep: undefined, status: 'loading', error: undefined, errorLabel: undefined, universeId: '2' })
	})

	test('observes successful and reverted receipts through the shared refresh boundary', async () => {
		const observed: string[] = []
		await observeKnownReceipt(Promise.resolve({ status: 'success' as const }), () => observed.push('success'))
		await observeKnownReceipt(Promise.resolve({ status: 'reverted' as const }), () => observed.push('reverted'))
		expect(observed).toEqual(['success', 'reverted'])
	})

	test('preserves the current market page when retry must rerun discovery', () => {
		expect(walletSummaryDiscoveryRetryStart('error', true, undefined, 50n)).toBe(50n)
		expect(walletSummaryDiscoveryRetryStart('ready', true, 'pool read failed', 75n)).toBe(75n)
		expect(walletSummaryDiscoveryRetryStart('ready', true, undefined, 50n)).toBeUndefined()
	})

	test('falls back to canonical setup without exposing stored configuration errors', async () => {
		window.history.replaceState(undefined, '', '/#/markets')
		let attempts = 0
		const rendered = await renderIntoDocument(
			<App
				deploymentSetupServices={{
					createPublicClient: () => {
						throw new Error('No deployment client expected')
					},
					loadCoreDeployments: async () => [],
				}}
				loadLiveDeployment={async () => {
					attempts++
					throw new Error('stored deployment unavailable')
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(0)
		})
		expect(rendered.container.textContent).not.toContain('stored deployment unavailable')
		expect(rendered.container.textContent).not.toContain('Retry configuration')
		expect(rendered.container.querySelector('h1')?.textContent).toBe('Deploy')
		expect(rendered.container.querySelector('.trading-wallet-actions .wallet-button')).not.toBeNull()
		expect(rendered.container.querySelector('main .route-header .wallet-button')).toBeNull()
		expect(attempts).toBe(1)
	})
})
