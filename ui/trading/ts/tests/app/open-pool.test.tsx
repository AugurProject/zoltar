import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { OpenPoolForm } from '../../features/OpenPoolForm.js'
import { LiveMarketBrowser } from '../../features/LiveMarketBrowser.js'
import { tradingRouting } from '../../lib/routing.js'

test('opens an addressed workflow and preserves simulation settings; rejects invalid addresses and locked navigation', async () => {
	const dom = installDomEnvironment('http://localhost/#/market?simulate=1&simScenario=trading-funded')
	const rendered = await renderIntoDocument(<OpenPoolForm disabled={false} />)
	try {
		const input = rendered.container.querySelector('input')
		const button = rendered.container.querySelector('button')
		const form = rendered.container.querySelector('form')
		if (input === null || button === null || form === null) throw new Error('Address form did not render')
		expect(button.disabled).toBe(true)
		for (const invalid of ['hello', '0x0000000000000000000000000000000000000000']) {
			await act(() => {
				input.value = invalid
				input.dispatchEvent(new Event('input', { bubbles: true }))
			})
			expect(button.disabled).toBe(true)
			expect(input.getAttribute('aria-invalid')).toBe('true')
		}
		const pool = '0x1111111111111111111111111111111111111111'
		await act(() => {
			input.value = ` ${pool} `
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(button.disabled).toBe(false)
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		expect(tradingRouting.resolve(window.location.hash)).toBe(`market/${pool}`)
		expect(window.location.hash).toContain('simScenario=trading-funded')
		await act(() => render(<OpenPoolForm disabled={true} target='liquidity' />, rendered.container))
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		expect(tradingRouting.resolve(window.location.hash)).toBe(`market/${pool}`)
		await act(() => render(<OpenPoolForm disabled={false} target='liquidity' />, rendered.container))
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		expect(tradingRouting.resolve(window.location.hash)).toBe(`liquidity/${pool}`)
		await act(() => render(<OpenPoolForm disabled={false} target='create-market' />, rendered.container))
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		expect(tradingRouting.resolve(window.location.hash)).toBe(`create-market/${pool}`)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('the market list search opens a pasted pool address even before any market is downloaded', async () => {
	const dom = installDomEnvironment('http://localhost/#/market?simulate=1&simScenario=trading-funded')
	const rendered = await renderIntoDocument(
		<LiveMarketBrowser
			freshness={{ refreshing: false, updatedAt: undefined }}
			lookupRoute='market'
			markets={[]}
			pageMarketCount={0}
			discoveryState='ready'
			discoveryError={undefined}
			marketPage={{ start: 0n, total: 0n, previousStart: undefined, nextStart: undefined }}
			workflowLocked={false}
			nowSeconds={0n}
			retry={() => undefined}
			loadMarketPage={() => undefined}
		/>,
	)
	try {
		expect(rendered.container.querySelector('.open-pool-form')).toBeNull()
		expect(rendered.container.querySelector('details')).toBeNull()
		const form = rendered.container.querySelector<HTMLFormElement>('form.market-list-search')
		const input = form?.querySelector<HTMLInputElement>('input[type="search"]')
		if (form === null || input === null || input === undefined) throw new Error('Market search did not render')
		expect(input.placeholder).toContain('paste a pool address')
		const type = (value: string) =>
			act(() => {
				input.value = value
				input.dispatchEvent(new Event('input', { bubbles: true }))
			})
		for (const notAnAddress of ['hello', '0x0000000000000000000000000000000000000000']) {
			await type(notAnAddress)
			expect(form.querySelector('button[type="submit"]')).toBeNull()
		}
		const pool = '0x1111111111111111111111111111111111111111'
		await type(` ${pool} `)
		// The action appears beside the field without replacing it, so typing keeps focus.
		expect(form.querySelector('input[type="search"]')).toBe(input)
		expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Open pool')
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		expect(tradingRouting.resolve(window.location.hash)).toBe(`market/${pool}`)
		expect(window.location.hash).toContain('simScenario=trading-funded')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('the liquidity list search opens a pasted pool address in the liquidity workflow', async () => {
	const dom = installDomEnvironment('http://localhost/#/liquidity')
	const rendered = await renderIntoDocument(
		<LiveMarketBrowser
			freshness={{ refreshing: false, updatedAt: undefined }}
			lookupRoute='liquidity'
			markets={[]}
			pageMarketCount={0}
			discoveryState='ready'
			discoveryError={undefined}
			marketPage={{ start: 0n, total: 0n, previousStart: undefined, nextStart: undefined }}
			workflowLocked={false}
			nowSeconds={0n}
			retry={() => undefined}
			loadMarketPage={() => undefined}
		/>,
	)
	try {
		const form = rendered.container.querySelector<HTMLFormElement>('form.market-list-search')
		const input = form?.querySelector<HTMLInputElement>('input[type="search"]')
		if (form === null || input === null || input === undefined) throw new Error('Market search did not render')
		const pool = '0x2222222222222222222222222222222222222222'
		await act(() => {
			input.value = pool
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		expect(tradingRouting.resolve(window.location.hash)).toBe(`liquidity/${pool}`)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})
