import { describe, expect, test } from 'bun:test'
import { signal } from '@preact/signals'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { RepPriceRefreshContext, RepPriceStatusLabel } from '@zoltar/ui-statoblast-shared/features/security-pools/components/RepPriceStatusLabel.js'
import { resolveRepPrice } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'

installDomTestLifecycle()

describe('REP price refresh control', () => {
	test('retries an unavailable quote and disables duplicate refreshes while busy', async () => {
		const busy = signal(false)
		const quote = signal<bigint | undefined>(undefined)
		let refreshes = 0
		function Price() {
			return (
				<RepPriceRefreshContext.Provider
					value={{
						busy: busy.value,
						onRefresh: () => {
							refreshes += 1
							busy.value = true
						},
					}}
				>
					<RepPriceStatusLabel refreshable repPrice={resolveRepPrice({ now: 1n, setting: 'open-oracle-fallback', uniswapPrice: quote.value })} />
				</RepPriceRefreshContext.Provider>
			)
		}
		const rendered = await renderIntoDocument(<Price />)
		try {
			const page = within(document.body)
			expect(page.getByText('No REP price')).toBeDefined()
			const refresh = page.getByRole('button', { name: 'Refresh REP prices' })
			fireEvent.click(refresh)
			await act(async () => undefined)
			expect(refreshes).toBe(1)
			expect(refresh.hasAttribute('disabled')).toBe(true)
			expect(refresh.getAttribute('aria-busy')).toBe('true')
			await act(async () => {
				quote.value = 10n ** 18n
				busy.value = false
			})
			expect(page.getByText('via Uniswap')).toBeDefined()
			expect(refresh.hasAttribute('disabled')).toBe(false)
			fireEvent.click(refresh)
			expect(refreshes).toBe(2)
		} finally {
			await rendered.cleanup()
		}
	})

	test.each(['open-oracle', 'uniswap'] as const)('only offers the Uniswap retry where requested (%s)', async setting => {
		const rendered = await renderIntoDocument(
			<RepPriceRefreshContext.Provider value={{ busy: false, onRefresh: () => undefined }}>
				<RepPriceStatusLabel refreshable={setting === 'open-oracle'} repPrice={resolveRepPrice({ now: 1n, setting, uniswapPrice: undefined })} />
			</RepPriceRefreshContext.Provider>,
		)
		try {
			expect(within(document.body).queryByRole('button', { name: 'Refresh REP prices' })).toBeNull()
		} finally {
			await rendered.cleanup()
		}
	})
})
