import { expect, test } from 'bun:test'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { PortfolioAggregatePanel } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioAggregatePanel.js'
import { usePortfolioAggregate } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioAggregate.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/portfolioCapital.js'
import { capitalSnapshot, owner, unit } from './capitalFixture.js'
const lifecycle = installDomTestLifecycle()
function Harness({ snapshot = capitalSnapshot() }: { snapshot?: ReturnType<typeof capitalSnapshot> }) {
	const model = usePortfolioAggregate({ snapshot, loading: false, error: undefined, refresh: async () => undefined }, { ownerReason: undefined, runPortfolioAction: async () => undefined }, owner)
	return <PortfolioAggregatePanel model={model} actions={{ scope: unscopedTransaction, busy: undefined }} />
}
test('personal capital shows exact principal and keeps distinct approval, deposit and retirement controls', async () => {
	const view = await renderIntoDocument(<Harness />)
	lifecycle.trackRendered(view)
	const text = view.container.textContent ?? ''
	const amounts = (label: string) => [...view.container.querySelectorAll('.metric-label')].filter(node => node.textContent === label).map(node => node.parentElement?.querySelector('.currency-value')?.getAttribute('title')?.replaceAll(/\s/g, ''))
	// The saved 120% target keeps 10 ETH × 2 REP/ETH × 1.05 × 1.2 = 25.2 REP.
	expect(amounts(copy.withdrawableRep)).toEqual(['4.8REP'])
	expect(amounts(copy.principalRep)).toEqual(['30REP'])
	expect(amounts(copy.commitment)).toEqual(['10ETH'])
	expect(amounts(copy.positionPledged)).toEqual(['30REP'])
	expect(amounts(copy.totalPledged)).toEqual(['100REP'])
	expect(amounts(copy.ethEarnings)).toEqual(['1ETH'])
	expect(amounts(copy.repEarnings)).toEqual(['2REP'])
	expect(text).toContain('120%')
	const labels = Array.from(view.container.querySelectorAll('button')).map(button => button.textContent ?? '')
	expect(labels.some(label => label.includes('Approve'))).toBe(true)
	expect(labels.some(label => label.includes('Deposit REP'))).toBe(true)
	expect(labels.some(label => label.includes('Request retirement'))).toBe(true)
	expect(labels.some(label => label.includes('Claim earnings'))).toBe(true)
	expect(text).not.toContain('Claim each question')
	expect(view.container.querySelectorAll('.card .card')).toHaveLength(0)
})

test('the reserve panel shows assigned ETH available after a missed fork choice', async () => {
	const snapshot = capitalSnapshot({ forkTime: 500n, forkChoiceDeadline: 1_000n, withdrawableExecutionReserveAttoEth: (101n * unit) / 100n })
	const view = await renderIntoDocument(<Harness snapshot={snapshot} />)
	lifecycle.trackRendered(view)
	const label = [...view.container.querySelectorAll('.metric-label')].find(node => node.textContent === copy.withdrawableExecution)
	expect(label?.parentElement?.querySelector('.currency-value')?.getAttribute('title')?.replaceAll(/\s/g, '')).toBe('1.01ETH')
	expect([...view.container.querySelectorAll('button')].some(button => button.textContent === 'Withdraw execution reserve')).toBe(true)
})
