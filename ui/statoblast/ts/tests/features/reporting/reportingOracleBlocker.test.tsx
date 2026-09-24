import { expect, test } from 'bun:test'
import { ReportingOracleBlocker } from '@zoltar/ui-statoblast-shared/features/reporting/components/ReportingOracleBlocker.js'
import { createOracleManagerDetails } from '../security-pools/workflow/builders.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { within, fireEvent } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'

let cleanup: (() => Promise<void>) | undefined
installDomTestLifecycle({
	afterTest: async () => {
		await cleanup?.()
		cleanup = undefined
	},
})

for (const state of ['expired', 'pending', 'ready', 'valid']) {
	test(`shows the ${state} oracle recovery step with only its available action`, async () => {
		let requested = 0
		let viewed: bigint | undefined
		let refreshed = 0
		const manager = createOracleManagerDetails({ pendingReportId: state === 'pending' || state === 'ready' ? 7n : 0n, pendingReportReadyAtTimestamp: 200n })
		const rendered = await renderIntoDocument(
			<ReportingOracleBlocker
				blocked={state !== 'valid'}
				manager={manager}
				now={state === 'ready' ? 201n : 100n}
				onRequest={() => requested++}
				requestReason={undefined}
				onRefresh={() => refreshed++}
				oracle={undefined}
				onViewReport={id => {
					viewed = id
				}}
			/>,
		)
		cleanup = rendered.cleanup
		const queries = within(rendered.container)
		if (state === 'expired') {
			expect(rendered.container.textContent).toContain('Pool price expired. Reports need a price newer than 5 minutes.')
			fireEvent.click(queries.getByRole('button', { name: 'Request new price…' }))
			expect(requested).toBe(1)
		} else if (state === 'pending') {
			expect(rendered.container.textContent).toContain('Price requested. Ready to settle in 1m.')
			expect(queries.queryByRole('button')).toBeNull()
		} else if (state === 'ready') {
			expect(rendered.container.textContent).toContain('Price report #7 is ready.')
			fireEvent.click(queries.getByRole('button', { name: 'Settle report #7…' }))
			expect(viewed).toBe(7n)
			expect(refreshed).toBe(1)
		} else {
			expect(queries.queryByRole('status')).toBeNull()
			expect(queries.queryByRole('button')).toBeNull()
		}
	})
}
