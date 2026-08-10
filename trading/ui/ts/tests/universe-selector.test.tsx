import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { App, compactUniverseId, UniverseSelector } from '../app/App.tsx'
import { demoMarket } from '../demo/markets.ts'
import { filterMarketsByUniverse } from '../features/LiveTrading.tsx'
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
					{ id: '2', label: 'Child universe · YES branch' },
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
		expect(select?.getAttribute('aria-label')).toBe('Universe')
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

	test('uses the header selection as the demo portfolio universe context', async () => {
		window.history.replaceState(undefined, '', '/?demo=1#/portfolio')
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		const select = rendered.container.querySelector<HTMLSelectElement>('.universe-selector select')
		const main = rendered.container.querySelector('main')
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
	})

	test('initializes the selector from the scenario universe', async () => {
		window.history.replaceState(undefined, '', '/?demo=1&scenario=max-token-ids#/portfolio')
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		const selected = demoMarket('max-token-ids').universeId.toString()
		const selector = rendered.container.querySelector<HTMLSelectElement>('.universe-selector select')
		expect(selector?.value).toBe(selected)
		expect(selector?.selectedOptions[0]?.textContent).toBe(`ID ${compactUniverseId(selected)}`)
		expect(selector?.selectedOptions[0]?.getAttribute('aria-label')).toBe(`Universe ID ${selected}`)
		const longOptions = Array.from(selector?.options ?? []).filter(option => option.value.length > 18)
		expect(longOptions).toHaveLength(2)
		expect(longOptions[0]?.textContent).not.toBe(longOptions[1]?.textContent)
		expect(longOptions.every(option => option.textContent?.includes('…') === true)).toBeTrue()
		expect(rendered.container.querySelector('main')?.textContent).toContain(((1n << 256n) - 256n).toString())
	})
})
