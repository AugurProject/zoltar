import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { App, buildLiveUniverseOptions, compactUniqueUniverseIds, compactUniverseId, UniverseSelector, WalletSummary, walletSummaryAfterRouteChange, walletSummaryForUniverse } from '../app/App.tsx'
import { demoMarket } from '../demo/markets.ts'
import { filterMarketsByUniverse, observeKnownReceipt, walletSummaryAvailability, walletSummaryDiscoveryRetryStart, walletSummaryRefreshState } from '../features/LiveTrading.tsx'
import type { DeploymentConfiguration } from '../protocol/config.ts'
import type { LiveMarket } from '../protocol/live.ts'
import { renderIntoDocument } from './test-support/renderIntoDocument.tsx'

describe('universe selector', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRendered: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment('http://localhost/?demo=1#/markets').cleanup
	})

	afterEach(async () => {
		await cleanupRendered?.()
		cleanupRendered = undefined
		cleanupDom?.()
		cleanupDom = undefined
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

	test('uses the header selection as the demo portfolio universe context', async () => {
		window.history.replaceState(undefined, '', '/?demo=1#/portfolio')
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		const select = rendered.container.querySelector<HTMLSelectElement>('.universe-selector select')
		const main = rendered.container.querySelector('main')
		const walletAddress = rendered.container.querySelector('.wallet-summary__address')
		const ethBalance = rendered.container.querySelector('[data-wallet-asset="ETH"]')
		const repBalance = rendered.container.querySelector('[data-wallet-asset="REP"]')
		expect(walletAddress?.textContent).toBe('0x8ba1f109551bD432803012645Ac136ddd64DBA72')
		expect(walletAddress?.textContent).not.toContain('…')
		expect(ethBalance?.textContent).toBe('ETH64')
		expect(repBalance?.textContent).toBe('REP12,500')
		expect(main?.textContent).toContain(demoMarket('baseline').pool)
		expect(main?.textContent).not.toContain('Genesis universe')
		expect(rendered.container.querySelectorAll('[data-portfolio-pool]')).toHaveLength(1)
		await act(() => {
			if (select === null) throw new Error('Universe selector is unavailable')
			select.value = demoMarket('truth-auction').universeId.toString()
			select.dispatchEvent(new Event('change', { bubbles: true }))
		})
		expect(main?.textContent).toContain(demoMarket('truth-auction').pool)
		expect(main?.textContent).not.toContain(demoMarket('baseline').pool)
		expect(repBalance?.textContent).toBe('REP1,750')
	})

	test('initializes the selector from the scenario universe', async () => {
		window.history.replaceState(undefined, '', '/?demo=1&scenario=max-token-ids#/portfolio')
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		const selected = demoMarket('max-token-ids').universeId.toString()
		const selector = rendered.container.querySelector<HTMLSelectElement>('.universe-selector select')
		expect(selector?.value).toBe(selected)
		expect(selector?.selectedOptions[0]?.textContent).toBe(`Universe ${compactUniverseId(selected)}`)
		expect(selector?.selectedOptions[0]?.getAttribute('aria-label')).toBe(`Universe ${selected}`)
		const longOptions = Array.from(selector?.options ?? []).filter(option => option.value.length > 18)
		expect(longOptions).toHaveLength(2)
		expect(longOptions[0]?.textContent).not.toBe(longOptions[1]?.textContent)
		expect(longOptions.every(option => option.textContent?.includes('…') === true)).toBeTrue()
		expect(rendered.container.querySelector('main')?.textContent).toContain(((1n << 256n) - 256n).toString())
	})

	test('keeps wallet balance failures visible without abbreviating the account', async () => {
		const account = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'
		let retries = 0
		const rendered = await renderIntoDocument(<WalletSummary summary={{ account, ethAttoEth: undefined, repAttoRep: undefined, status: 'error', error: 'REP balance RPC failed', errorLabel: 'Wallet balance read failed', universeId: '1' }} onRetry={() => retries++} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.wallet-summary__address')?.textContent).toBe(account)
		expect(rendered.container.querySelector('[data-wallet-asset="ETH"]')?.textContent).toBe('ETH—')
		expect(rendered.container.querySelector('[data-wallet-asset="REP"]')?.textContent).toBe('REP—')
		expect(rendered.container.querySelector('[role="alert"]')?.textContent).toBe('Wallet balance read failed')
		expect(rendered.container.querySelector('[role="alert"]')?.getAttribute('aria-label')).toContain('REP balance RPC failed')
		await act(() => rendered.container.querySelector<HTMLButtonElement>('.wallet-summary__retry')?.click())
		expect(retries).toBe(1)
	})

	test('ends wallet balance loading when selected-universe discovery fails', async () => {
		expect(walletSummaryAvailability(true, undefined, 'loading', undefined, true)?.status).toBe('loading')
		const availability = walletSummaryAvailability(true, undefined, 'error', 'RPC request failed', true)
		if (availability === undefined) throw new Error('A discovery failure must make wallet balances unavailable')
		const rendered = await renderIntoDocument(<WalletSummary summary={{ account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', ethAttoEth: undefined, repAttoRep: undefined, status: availability.status, error: availability.error, errorLabel: availability.errorLabel, universeId: '1' }} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.wallet-summary')?.getAttribute('aria-busy')).toBe('false')
		expect(rendered.container.querySelector('[role="alert"]')?.getAttribute('aria-label')).toContain('SecurityPool discovery failed: RPC request failed')
	})

	test('preserves all 18 decimals in authoritative wallet balances', async () => {
		const rendered = await renderIntoDocument(<WalletSummary summary={{ account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', ethAttoEth: 1n, repAttoRep: 2n ** 256n - 1n, status: 'ready', error: undefined, errorLabel: undefined, universeId: '1' }} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[data-wallet-asset="ETH"] strong')?.textContent).toBe('0.000000000000000001')
		expect(rendered.container.querySelector('[data-wallet-asset="REP"] strong')?.textContent).toEndWith('.584007913129639935')
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

	test('recovers from an unavailable deployment through the visible retry control', async () => {
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
		let attempts = 0
		const rendered = await renderIntoDocument(
			<App
				loadLiveDeployment={async () => {
					attempts++
					if (attempts === 1) throw new Error('deployment RPC unavailable')
					return configuration
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(10)
		})
		const retry = Array.from(rendered.container.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === 'Retry deployment')
		expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('deployment RPC unavailable')
		if (!(retry instanceof HTMLButtonElement)) throw new Error('Deployment retry control is unavailable')
		await act(async () => {
			retry.click()
			await Bun.sleep(10)
		})
		await act(async () => {
			await Bun.sleep(10)
		})
		expect(attempts).toBe(2)
		expect(rendered.container.textContent).toContain('Verified live deployment')
		expect(rendered.container.textContent).not.toContain('Retry deployment')
	})
})
