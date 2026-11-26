import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { useLayoutEffect } from 'preact/hooks'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { withFakeClock } from '@zoltar/ui-core-shared/tests/testUtils/fakeClock.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { SecurityPoolAggregatePanel } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolAggregatePanel.js'
import { useSecurityPoolAggregate } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolAggregate.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/securityPoolCapital.js'
import { capitalSnapshot, owner, unit } from './capitalFixture.js'
const lifecycle = installDomTestLifecycle()
function Harness({ snapshot = capitalSnapshot(), lastFailedAction, displayedAt }: { snapshot?: ReturnType<typeof capitalSnapshot>; lastFailedAction?: string; displayedAt?: number }) {
	const model = useSecurityPoolAggregate({ snapshot, loading: false, error: undefined, displayedAt, refresh: async () => undefined }, { ownerReason: undefined, runSecurityPoolAction: async () => undefined }, owner)
	return <SecurityPoolAggregatePanel model={model} actions={{ scope: unscopedTransaction, busy: undefined, ...(lastFailedAction === undefined ? {} : { lastFailedAction }) }} />
}

test.each(['ready', 'insufficient-spare', 'retry'] as const)('redesigned reduction shows the saved queue with %s action', async state => {
	const base = capitalSnapshot()
	const coversAll = state !== 'insufficient-spare'
	const snapshot = {
		...base,
		positions: base.positions.map(position => ({
			...position,
			batch: 1n,
			remainingCommitment: 6n * unit,
			retirementPreview: { status: coversAll ? ('ready' as const) : ('insufficient-spare' as const), effectiveCurrentBatch: 1n, healthyCommitment: 20n * unit, spareCommitment: (coversAll ? 9n : 3n) * unit, queuedAheadCommitment: 2n * unit, commitmentReduction: 4n * unit, releasedRep: 0n },
		})),
	}
	const failedAction = state === 'retry' ? { lastFailedAction: 'serveSecurityPoolRetirement' } : {}
	const view = await renderIntoDocument(<Harness snapshot={snapshot} {...failedAction} />)
	lifecycle.trackRendered(view)
	const reduction = view.container.querySelector('section:has([id$="-reduce"])')
	const text = reduction?.textContent ?? ''
	expect(text).not.toContain('Position 1')
	expect(text).not.toContain('Liquidation threshold')
	expect(text.includes('covers all')).toBe(coversAll)
	const labels = { retry: copy.retryRelease, ready: 'Release reduction (keep 6 WETH)', 'insufficient-spare': copy.waitingForFreeCapacity }
	const label = labels[state]
	const button = [...(reduction?.querySelectorAll('button') ?? [])].find(button => button.textContent?.replaceAll('\u00a0', ' ') === label)
	expect(button?.disabled).toBe(!coversAll)
})

test('Capital starts with the saved target and commitment and lists only the planned actions', async () => {
	const view = lifecycle.trackRendered(await renderIntoDocument(<Harness />))
	const plan = view.container.querySelector('section:has([id$="-commitment"])')
	const actions = () => [...(plan?.querySelectorAll('ol > li .tx-action-button') ?? [])].map(button => button.textContent)
	const input = (text: string) => [...(plan?.querySelectorAll('input') ?? [])].find(field => field.labels?.[0]?.textContent === text)
	const update = async (text: string, value: string) => {
		const field = input(text)
		if (field === undefined) throw new Error('Capital field missing')
		await act(() => {
			field.value = value
			field.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}
	expect(input(copy.commitment)?.value).toBe('10')
	expect(input(copy.optionalHealthDeposit)?.value).toBe('')
	expect(actions()).toEqual([])
	await update(copy.health, '130')
	expect(actions()).toEqual([copy.saveHealth])
	await update(copy.optionalHealthDeposit, '3')
	await update(copy.commitment, '11')
	expect(actions().slice(-2)).toEqual([copy.depositHealth, copy.setCommitment])
	expect(plan?.querySelector('ol > li:last-child button')?.hasAttribute('disabled')).toBe(true)
})
test('personal capital shows exact principal and keeps distinct approval, deposit and retirement controls', async () => {
	const view = await renderIntoDocument(<Harness />)
	lifecycle.trackRendered(view)
	const text = view.container.textContent ?? ''
	const amounts = (label: string) => [...view.container.querySelectorAll('.metric-label')].filter(node => node.textContent === label).map(node => node.parentElement?.querySelector('.currency-value')?.getAttribute('title')?.replaceAll(/\s/g, ''))
	// The saved 120% target keeps 10 WETH × 2 REP/WETH × 1.05 × 1.2 = 25.2 REP.
	expect(amounts(copy.withdrawableRep)).toEqual(['4.8REP'])
	expect(amounts(copy.principalRep)).toEqual(['30REP'])
	expect(amounts(copy.commitment)).toEqual(['10WETH'])
	expect(amounts(copy.ethEarnings)).toEqual(['1WETH'])
	expect(amounts(copy.repEarnings)).toEqual(['2REP'])
	expect(text).toContain('120%')
	const labels = Array.from(view.container.querySelectorAll('button')).map(button => button.textContent ?? '')
	expect(labels.some(label => label.includes('Approve'))).toBe(true)
	expect(labels.some(label => label.includes('Deposit REP'))).toBe(true)
	expect(labels.some(label => label.includes(copy.requestReduction))).toBe(true)
	expect(labels.some(label => label.includes('Claim earnings'))).toBe(true)
	expect(text).not.toContain('Claim each question')
	expect(text).not.toContain('Execution reserve')
	expect(labels.some(label => label.includes('Fund execution'))).toBe(false)
	expect(view.container.querySelectorAll('.card .card')).toHaveLength(0)
})

test('draft initialization preserves a deposit entered as the panel becomes interactive', async () => {
	function InitialDeposit({ ready }: { ready: boolean }) {
		const snapshot = ready ? capitalSnapshot() : undefined
		const model = useSecurityPoolAggregate({ snapshot, loading: !ready, error: undefined, refresh: async () => undefined }, { ownerReason: undefined, runSecurityPoolAction: async () => undefined }, owner)
		useLayoutEffect(() => {
			if (ready) model.setDepositAmount('1')
		}, [ready])
		return <output>{model.depositAmount}</output>
	}

	const view = await renderIntoDocument(<InitialDeposit ready={false} />)
	lifecycle.trackRendered(view)
	render(<InitialDeposit ready />, view.container)
	await waitFor(() => expect(view.container.textContent).toBe('1'))
})

test('earlier reductions and free capacity remain visible when a release cannot complete', async () => {
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
	const view = lifecycle.trackRendered(await renderIntoDocument(<Harness snapshot={snapshot} />))
	const queue = view.container.querySelector('section:has([id$="-reduce"])')
	const text = queue?.textContent?.replaceAll('\u00a0', ' ')
	expect(text).toContain(copy.queueAhead)
	expect(text).toContain('2.00 WETH')
	expect(text).toContain(copy.queueYourReduction)
	expect(text).toContain('5.00 WETH')
	expect(text).toContain(copy.queueFreeNow('1.00 WETH', undefined))
	expect(queue?.querySelector('button')?.disabled).toBe(true)
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

test('earnings show what claiming pays, and the credited amounts when that preview is unavailable', async () => {
	const snapshot = capitalSnapshot({ accruedFeesAttoEth: unit, accruedFeesAttoRep: 2n * unit })
	const metric = (view: Awaited<ReturnType<typeof renderIntoDocument>>, label: string) =>
		[...view.container.querySelectorAll('.metric-label')]
			.find(node => node.textContent === label)
			?.parentElement?.querySelector('.currency-value')
			?.getAttribute('title')
			?.replaceAll(/\s/g, '')
	const credited = await renderIntoDocument(<Harness snapshot={snapshot} />)
	expect(metric(credited, copy.ethEarnings)).toBe('1WETH')
	expect(metric(credited, copy.repEarnings)).toBe('2REP')
	await credited.cleanup()
	const claimable = await renderIntoDocument(<Harness snapshot={{ ...snapshot, claimableEarnings: { attoEth: 5n * unit, attoRep: 7n * unit } }} />)
	lifecycle.trackRendered(claimable)
	expect(metric(claimable, copy.ethEarnings)).toBe('5WETH')
	expect(metric(claimable, copy.repEarnings)).toBe('7REP')
})

test('claims remain usable and describe the age of the last successful Capital read', async () => {
	await withFakeClock(async ({ advance }) => {
		const snapshot = capitalSnapshot({ accruedFeesAttoEth: unit, accruedFeesAttoRep: 2n * unit })
		const view = lifecycle.trackRendered(await renderIntoDocument(<Harness snapshot={snapshot} displayedAt={Date.now() - 59_999} />))
		const earnings = view.container.querySelector('section:has([id$="-earnings"])')
		const description = () => earnings?.querySelector('.section-block-copy')?.textContent
		await advance(1)
		expect(description()).not.toContain('Checked again before sending.')
		await advance(1)
		expect(description()).toContain('Data from 1m ago. Checked again before sending.')
		expect(earnings?.querySelector('button')?.disabled).toBe(false)
		await act(() => render(<Harness snapshot={snapshot} displayedAt={Date.now()} />, view.container))
		expect(description()).not.toContain('Checked again before sending.')
		await view.cleanup()
	})
})

test('a pending reduction keeps the saved amount locked', async () => {
	const base = capitalSnapshot()
	const snapshot = { ...base, positions: base.positions.map(position => ({ ...position, batch: 1n, remainingCommitment: 5n * unit })) }
	const view = lifecycle.trackRendered(await renderIntoDocument(<Harness snapshot={snapshot} />))
	const queue = view.container.querySelector('section:has([id$="-reduce"])')
	expect(queue?.textContent?.replaceAll('\u00a0', ' ')).toContain('5 WETH')
	expect(queue?.querySelector('input')).toBeNull()
})
