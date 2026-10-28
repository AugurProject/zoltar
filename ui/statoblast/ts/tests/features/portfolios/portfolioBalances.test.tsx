import { expect, test } from 'bun:test'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { PortfolioAggregatePanel } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioAggregatePanel.js'
import { usePortfolioAggregate } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioAggregate.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/portfolioCapital.js'
import { capitalSnapshot, owner, unit } from './capitalFixture.js'
import { formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
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

test('retirement readiness exposes the reserved capacity and observed times without promising completion', async () => {
	const base = capitalSnapshot()
	const snapshot = {
		...base,
		positions: base.positions.map(position => ({
			...position,
			batch: 1n,
			remainingCommitment: 5n * unit,
			liquidationStarted: 900n,
			retirementPreview: { status: 'earlier-requests' as const, effectiveCurrentBatch: 1n, healthyCommitment: 20n * unit, spareCommitment: unit, queuedAheadCommitment: 2n * unit, commitmentReduction: 5n * unit, releasedRep: 0n },
		})),
	}
	const view = await renderIntoDocument(<Harness snapshot={snapshot} />)
	lifecycle.trackRendered(view)
	const text = view.container.textContent ?? ''
	expect(text).toContain(copy.retirementPreviewStatus['earlier-requests'])
	expect(text).toContain(copy.retirementPreviewHint)
	expect(text).toContain(copy.liquidationTimingHint)
	for (const timestamp of [900n, snapshot.timestamp, snapshot.priceValidUntil]) expect(text).toContain(formatTimestamp(timestamp))
	const amount = (label: string) =>
		[...view.container.querySelectorAll('.metric-label')]
			.find(node => node.textContent === label)
			?.parentElement?.querySelector('.currency-value')
			?.getAttribute('title')
			?.replaceAll(/\s/g, '')
	expect(amount(copy.retirementSpare)).toBe('1ETH')
	expect(amount(copy.retirementAhead)).toBe('2ETH')
	expect(amount(copy.retirementReduction)).toBe('5ETH')
})

test('stale prices and closed universes never present a ready retirement preview', async () => {
	const base = capitalSnapshot()
	const positions = base.positions.map(position => ({ ...position, batch: 1n, retirementPreview: { status: 'ready' as const, effectiveCurrentBatch: 1n, healthyCommitment: 20n * unit, spareCommitment: 10n * unit, queuedAheadCommitment: 0n, commitmentReduction: position.commitment, releasedRep: position.rep } }))
	for (const [overrides, expected] of [
		[{ priceValid: false }, copy.retirementPreviewStale],
		[{ forkTime: 900n }, copy.retirementPreviewClosed],
		[{ importing: true }, copy.retirementPreviewClosed],
		[{ frozen: true }, copy.retirementPreviewClosed],
		[{ exported: true }, copy.retirementPreviewClosed],
	] as const) {
		const view = await renderIntoDocument(<Harness snapshot={{ ...base, ...overrides, positions }} />)
		lifecycle.trackRendered(view)
		expect(view.container.textContent).toContain(expected)
		expect(view.container.textContent).not.toContain(copy.retirementPreviewStatus.ready)
	}
})
