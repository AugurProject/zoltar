import { describe, expect, test } from 'bun:test'
import { parseSnapshot } from '../../src/dashboard/dashboard-data.ts'
import { obligationDetail } from '../../src/dashboard/dashboard-format.ts'
import { formatDate } from '../../src/dashboard/dom.ts'
import { publicChaosState } from '../../src/dashboard/public-state.ts'
import type { DurableObligation } from '../../src/state/operator-state.ts'

function durableObligation(expiresAt?: string): DurableObligation {
	return {
		attemptCount: 0,
		automaticRetryCount: 0,
		blockers: [],
		createdAt: '2026-08-24T00:00:00.000Z',
		ecosystem: 'open-oracle',
		...(expiresAt === undefined ? {} : { expiresAt }),
		id: 'open-oracle.settle:7',
		label: 'Settle report',
		metadata: { reportId: '7' },
		operationId: 'open-oracle.settle',
		status: 'pending',
		updatedAt: '2026-08-24T00:00:00.000Z',
		workflowId: 'workflow-1',
	}
}

function publishedObligation(obligation: DurableObligation) {
	const published = parseSnapshot(publicChaosState({ obligations: [obligation] })).obligations[0]
	if (published === undefined) throw new Error('Missing published obligation')
	return published
}

describe('lifecycle obligation deadlines on the dashboard', () => {
	test('publishes the durable deadline and shows it in the obligation detail', () => {
		const published = publishedObligation(durableObligation('2026-08-24T01:00:00.000Z'))

		expect(published.expiresAt).toBe('2026-08-24T01:00:00.000Z')
		expect(obligationDetail(published)).toBe(`OpenOracle · deadline ${formatDate('2026-08-24T01:00:00.000Z')}`)
	})

	test('shows an obligation without a deadline as unscheduled', () => {
		const published = publishedObligation(durableObligation())

		expect(published.expiresAt).toBeUndefined()
		expect(obligationDetail(published)).toBe('OpenOracle · deadline Not scheduled')
	})
})
