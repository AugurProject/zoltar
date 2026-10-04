import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveMarketBrowser } from '../../features/LiveMarketBrowser.js'
import { tradingRouting } from '../../lib/routing.js'

test('the market list search opens a pasted pool address even before any market is downloaded', async () => {
	const dom = installDomEnvironment('http://localhost/#/market?simulate=1&simScenario=trading-funded')
	const rendered = await renderIntoDocument(<LiveMarketBrowser lookupRoute='market' markets={[]} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={0n} retry={() => undefined} />)
	try {
		expect(rendered.container.querySelector('.open-pool-form')).toBeNull()
		expect(rendered.container.querySelector('details')).toBeNull()
		const form = rendered.container.querySelector<HTMLFormElement>('form.market-list-search')
		const input = form?.querySelector<HTMLInputElement>('input[type="search"]')
		if (form === null || input === null || input === undefined) throw new Error('Market search did not render')
		expect(input.placeholder).toContain('paste a security pool address')
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
		expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Open security pool')
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		expect(tradingRouting.resolve(window.location.hash)).toBe(`market/${pool}`)
		expect(window.location.hash).toContain('simScenario=trading-funded')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

for (const target of ['liquidity', 'create-market'] as const)
	test(`${target} search opens a pasted pool address in its workflow`, async () => {
		const dom = installDomEnvironment('http://localhost/#/liquidity')
		const rendered = await renderIntoDocument(<LiveMarketBrowser lookupRoute={target} markets={[]} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={0n} retry={() => undefined} />)
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
			expect(tradingRouting.resolve(window.location.hash)).toBe(`${target}/${pool}`)
		} finally {
			await rendered.cleanup()
			dom.cleanup()
		}
	})
