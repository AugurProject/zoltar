import { expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { PortfolioOperationHistory } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioBalances.js'

const lifecycle = installDomTestLifecycle()

test('opens native operation history with the selected contract vault and universe', async () => {
	const owner = getAddress('0x0000000000000000000000000000000000000011')
	const vault = getAddress('0x0000000000000000000000000000000000000022')
	const pool = getAddress('0x0000000000000000000000000000000000000033')
	lifecycle.trackRendered(
		await renderIntoDocument(
			<PortfolioOperationHistory
				model={{ historyWarning: 'Recent history could not be saved.', selection: { owner, vault, portfolio: pool, originUniverseId: 0n }, history: [{ key: 'operation', coordinator: pool, pool, operationId: '7', operation: '3', fromBlock: '1', universeId: '4', questionId: '5', result: { status: 'unknown' } }] }}
			/>,
		),
	)
	const link = within(document.body).getByRole('link', { name: 'Open native operation workflow' })
	const parameters = new URLSearchParams(link.getAttribute('href')?.split('?')[1])
	expect(parameters.get('universe')).toBe('4')
	expect(parameters.get('vault')).toBe(vault)
	expect(document.body.textContent).toContain('Recent history could not be saved.')
})
