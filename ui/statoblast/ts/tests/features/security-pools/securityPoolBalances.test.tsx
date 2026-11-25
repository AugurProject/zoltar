import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { useLayoutEffect } from 'preact/hooks'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { SecurityPoolAggregatePanel } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolAggregatePanel.js'
import { useSecurityPoolAggregate } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolAggregate.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/securityPoolCapital.js'
import { capitalSnapshot, owner, unit } from './capitalFixture.js'
import { formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
const lifecycle = installDomTestLifecycle()
function Harness({ snapshot = capitalSnapshot(), redesigned, lastFailedAction }: { snapshot?: ReturnType<typeof capitalSnapshot>; redesigned?: boolean; lastFailedAction?: string }) {
	const model = useSecurityPoolAggregate({ snapshot, loading: false, error: undefined, refresh: async () => undefined }, { ownerReason: undefined, runSecurityPoolAction: async () => undefined }, owner, redesigned)
	return <SecurityPoolAggregatePanel model={model} redesigned={redesigned ?? false} actions={{ scope: unscopedTransaction, busy: undefined, ...(lastFailedAction === undefined ? {} : { lastFailedAction }) }} />
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
	const view = await renderIntoDocument(<Harness redesigned snapshot={snapshot} {...failedAction} />)
	lifecycle.trackRendered(view)
	const reduction = view.container.querySelector('section:has([id$="-reduce"])')
	const text = reduction?.textContent ?? ''
	expect(text).not.toContain(copy.position(1n))
	expect(text).not.toContain(copy.liquidationHealth)
	expect(text.includes('covers all')).toBe(coversAll)
	const labels = { retry: copy.retryRelease, ready: 'Release reduction (keep 6 WETH)', 'insufficient-spare': copy.waitingForFreeCapacity }
	const label = labels[state]
	const button = [...(reduction?.querySelectorAll('button') ?? [])].find(button => button.textContent?.replaceAll('\u00a0', ' ') === label)
	expect(button?.disabled).toBe(!coversAll)
})

test('Capital starts with the saved target and commitment and lists only the planned actions', async () => {
	const view = lifecycle.trackRendered(await renderIntoDocument(<Harness redesigned />))
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
	expect(amounts(copy.positionPledged)).toEqual(['30REP'])
	expect(amounts(copy.totalPledged)).toEqual(['100REP'])
	expect(amounts(copy.ethEarnings)).toEqual(['1WETH'])
	expect(amounts(copy.repEarnings)).toEqual(['2REP'])
	expect(text).toContain('120%')
	const labels = Array.from(view.container.querySelectorAll('button')).map(button => button.textContent ?? '')
	expect(labels.some(label => label.includes('Approve'))).toBe(true)
	expect(labels.some(label => label.includes('Deposit REP'))).toBe(true)
	expect(labels.some(label => label.includes(copy.retire))).toBe(true)
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
	expect(amount(copy.reductionFreeCapacity)).toBe('1WETH')
	expect(amount(copy.retirementAhead)).toBe('2WETH')
	expect(amount(copy.retirementReduction)).toBe('5WETH')
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

test('a pending position exposes re-submission without unlocking its saved target', async () => {
	const base = capitalSnapshot()
	const snapshot = { ...base, positions: base.positions.map(position => ({ ...position, batch: 1n, remainingCommitment: 5n * unit })) }
	const view = await renderIntoDocument(<Harness snapshot={snapshot} />)
	lifecycle.trackRendered(view)
	const button = [...view.container.querySelectorAll('button')].find(button => button.textContent === copy.resubmitRetirement)
	expect(button?.disabled).toBe(false)
	expect(view.container.textContent).not.toContain(copy.remainingCommitmentHint)
})

test.each([0n, 3n * unit])('available backing uses the canonical purchase capacity (%s)', async available => {
	const view = await renderIntoDocument(<Harness snapshot={{ ...capitalSnapshot(), availableMintCapacityAttoEth: available }} />)
	lifecycle.trackRendered(view)
	const value = [...view.container.querySelectorAll('.metric-label')]
		.find(node => node.textContent === copy.availableCapacity)
		?.parentElement?.querySelector('.currency-value')
		?.getAttribute('title')
		?.replaceAll(/\s/g, '')
	expect(value).toBe(`${available / unit}WETH`)
})
