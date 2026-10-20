import { expect, test } from 'bun:test'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { PortfolioAggregatePanel } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioAggregatePanel.js'
import { usePortfolioAggregate } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioAggregate.js'
import { capitalSnapshot, owner } from './capitalFixture.js'
const lifecycle = installDomTestLifecycle()
function Harness() {
	const model = usePortfolioAggregate({ snapshot: capitalSnapshot(), loading: false, error: undefined, refresh: async () => undefined }, { ownerReason: undefined, runPortfolioAction: async () => undefined }, owner)
	return <PortfolioAggregatePanel model={model} actions={{ scope: unscopedTransaction, busy: undefined }} />
}
test('personal capital shows exact principal and keeps distinct approval, deposit and retirement controls', async () => {
	const view = await renderIntoDocument(<Harness />)
	lifecycle.trackRendered(view)
	const text = view.container.textContent ?? ''
	expect(text).toContain('Your free REP')
	expect(text).toContain('Pledged REP')
	expect(text).toContain('120%')
	const labels = Array.from(view.container.querySelectorAll('button')).map(button => button.textContent ?? '')
	expect(labels.some(label => label.includes('Approve'))).toBe(true)
	expect(labels.some(label => label.includes('Deposit REP'))).toBe(true)
	expect(labels.some(label => label.includes('Request retirement'))).toBe(true)
	expect(labels.some(label => label.includes('Claim earnings'))).toBe(true)
	expect(text).not.toContain('Claim each question')
	expect(view.container.querySelectorAll('.card .card')).toHaveLength(0)
})
