import { expect, test } from 'bun:test'
import { OpenOraclePriceValue } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/OpenOraclePriceValue.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'

let cleanup: (() => Promise<void>) | undefined
installDomTestLifecycle({
	afterTest: async () => {
		await cleanup?.()
		cleanup = undefined
	},
})

test('labels the settled price as REP per ETH and counts down its validity window', async () => {
	const rendered = await renderIntoDocument(<OpenOraclePriceValue currentTimestamp={1_000n} lastPrice={3n * 10n ** 18n} lastSettlementTimestamp={900n} priceValidUntilTimestamp={1_061n} />)
	cleanup = rendered.cleanup

	expect(document.body.textContent).toContain('3.00 REP per ETH')
	expect(document.body.querySelector('.oracle-price-validity')?.textContent).toBe('(valid for 1m 1s)')
	// The final minute counts down in seconds instead of collapsing into one coarse label.
	await waitFor(() => expect(document.body.querySelector('.oracle-price-validity')?.textContent).toMatch(/^\(valid for [1-5]?\ds\)$/u), { timeout: 4_000 })
})
