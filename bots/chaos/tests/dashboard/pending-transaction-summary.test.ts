import { describe, expect, test } from 'bun:test'
import { pendingTransactionSummary } from '../../src/dashboard/pending-transaction-summary.ts'

const now = Date.parse('2026-09-11T10:20:00.000Z')
const checkedAt = '2026-09-11T10:19:40.000Z'

describe('pendingTransactionSummary', () => {
	test('explains an included transaction that is waiting for finality', () => {
		expect(pendingTransactionSummary({ maxBlockNumber: '9152250', observation: { checkedAt, head: '9152215', includedBlock: '9152201', kind: 'awaiting-finality' }, status: 'confirmation-unknown' }, now)).toEqual({
			detail: 'quorum block 9152215 · 14 blocks after inclusion · checked 20s ago',
			headline: 'Included in block 9152201; waiting for finality',
			tone: 'info',
		})
	})

	test('warns when an included transaction has finalized but its confirmation evidence cannot be read', () => {
		expect(pendingTransactionSummary({ observation: { checkedAt, head: '9152202', includedBlock: '9152201', kind: 'evidence-unavailable' } }, now)).toEqual({
			detail: 'quorum block 9152202 · 1 block after inclusion · checked 20s ago',
			headline: 'Included in block 9152201; confirmation evidence unavailable',
			tone: 'warning',
		})
	})

	test('explains a transaction the quorum still sees pending, with the remaining resubmission window', () => {
		expect(pendingTransactionSummary({ maxBlockNumber: 9152250, observation: { checkedAt, head: 9152249, kind: 'in-mempool' } }, now)).toEqual({
			detail: 'quorum block 9152249 · resubmission window closes at block 9152250 (1 block left) · checked 20s ago',
			headline: 'Not included yet; the RPC quorum sees it pending',
			tone: 'info',
		})
	})

	test('flags bytes the quorum cannot see, resubmissions, closed windows, and nonce drift as warnings', () => {
		expect(pendingTransactionSummary({ maxBlockNumber: '120', observation: { checkedAt, head: '99', kind: 'not-visible' } }, now)).toEqual({
			detail: 'quorum block 99 · resubmission window closes at block 120 (21 blocks left) · checked 20s ago',
			headline: 'Not included and not visible to the RPC quorum',
			tone: 'warning',
		})
		expect(pendingTransactionSummary({ maxBlockNumber: '120', observation: { checkedAt: '2026-09-11T10:05:00.000Z', head: '99', kind: 'resubmitted' } }, now)).toEqual({
			detail: 'quorum block 99 · resubmission window closes at block 120 (21 blocks left) · checked 15m ago',
			headline: 'Not included; identical signed bytes were resubmitted',
			tone: 'warning',
		})
		expect(pendingTransactionSummary({ maxBlockNumber: '120', observation: { checkedAt: '2026-09-11T07:00:00.000Z', head: '121', kind: 'window-closed' } }, now)).toEqual({
			detail: 'quorum block 121 · resubmission window closed at block 120 · checked 3h ago',
			headline: 'Not included; the resubmission window closed',
			tone: 'warning',
		})
		expect(pendingTransactionSummary({ observation: { checkedAt, head: '99', kind: 'manual-reconciliation' } }, now)).toEqual({
			detail: 'quorum block 99 · checked 20s ago',
			headline: 'Not included; the signer nonce no longer matches',
			tone: 'warning',
		})
	})

	test('lets a recovery blocker replace the headline while the transaction is not included', () => {
		const recoveryBlocker = 'Automatic resubmission window closed; verify a receipt, exact replacement, or nonce cancellation'
		expect(pendingTransactionSummary({ maxBlockNumber: '120', observation: { checkedAt, head: '121', kind: 'window-closed' }, recoveryBlocker }, now)).toEqual({
			detail: 'quorum block 121 · resubmission window closed at block 120 · checked 20s ago',
			headline: recoveryBlocker,
			tone: 'warning',
		})
		expect(pendingTransactionSummary({ recoveryBlocker, status: 'signed' }, now)).toEqual({ detail: '', headline: recoveryBlocker, tone: 'warning' })
		expect(pendingTransactionSummary({ observation: { checkedAt, head: '121', includedBlock: '120', kind: 'awaiting-finality' }, recoveryBlocker }, now)).toEqual({
			detail: 'quorum block 121 · 1 block after inclusion · checked 20s ago',
			headline: 'Included in block 120; waiting for finality',
			tone: 'info',
		})
	})

	test('describes a queued replacement or cancellation instead of the observation that preceded it', () => {
		const stale = { checkedAt: '2026-09-11T07:00:00.000Z', head: '99', kind: 'manual-reconciliation' }
		expect(pendingTransactionSummary({ observation: stale, recoveryBlocker: 'Signer nonce 3 was consumed', replacementHash: `0x${'34'.repeat(32)}` }, now)).toEqual({
			detail: 'Waiting for its finalized receipt before the original intent is closed.',
			headline: 'Verifying the queued replacement',
			tone: 'info',
		})
		expect(pendingTransactionSummary({ cancellationHash: `0x${'56'.repeat(32)}`, observation: stale }, now)).toEqual({
			detail: 'Waiting for its finalized receipt before the original intent is closed.',
			headline: 'Verifying the queued cancellation',
			tone: 'info',
		})
	})

	test('describes intents that have not been checked yet', () => {
		expect(pendingTransactionSummary({ status: 'signed' }, now)).toEqual({ detail: '', headline: 'Signed; not broadcast yet', tone: 'info' })
		expect(pendingTransactionSummary({ status: 'submitted', submittedAt: '2026-09-11T10:19:00.000Z' }, now)).toEqual({ detail: 'Submitted 1m ago', headline: 'Broadcast; not checked yet', tone: 'info' })
		expect(pendingTransactionSummary({ status: 'submitted' }, now)).toEqual({ detail: '', headline: 'Broadcast; not checked yet', tone: 'info' })
	})

	test('tolerates malformed block numbers and unknown kinds', () => {
		expect(pendingTransactionSummary({ maxBlockNumber: 'abc', observation: { checkedAt: 'never', head: -1, kind: 'in-mempool' } }, now)).toEqual({
			detail: 'checked at an unknown time',
			headline: 'Not included yet; the RPC quorum sees it pending',
			tone: 'info',
		})
		expect(pendingTransactionSummary({ observation: { checkedAt, head: '5', kind: 'mystery' } }, now)).toEqual({ detail: 'quorum block 5 · checked 20s ago', headline: 'Waiting for the transaction', tone: 'info' })
	})
})
