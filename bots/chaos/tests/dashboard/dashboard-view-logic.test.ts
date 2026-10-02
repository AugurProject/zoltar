import { expect, test } from 'bun:test'
import { completeConfigurationScope, connectivityScope, draftAfterRevisionChange, executionPolicyScope } from '../../src/dashboard/configuration-draft-scope.ts'
import { parseConfiguration } from '../../src/dashboard/dashboard-data.ts'
import { mutationsSettled, put, readThroughPut, settledMutations } from '../../src/dashboard/dashboard-requests.ts'
import { formatRelative, stepValueLabel } from '../../src/dashboard/dashboard-format.ts'
import { executionPolicyReviewRows } from '../../src/dashboard/execution-policy-review.ts'
import { parsePublicRetirement, retirementBlockerDescription, retirementPositionDescription } from '../../src/dashboard/retirement-dashboard.ts'

const saved = {
	allowHighRiskOperations: false,
	connectivity: { publicRpcUrls: ['https://submit.example/'], quorumRpcUrls: ['https://read-two.example/'], readRpcUrl: 'https://read.example/', rpcQuorum: 2 },
	enabledEcosystems: ['zoltar', 'trading'],
	execute: false,
	maximumDelaySeconds: 3_600,
	minimumDelaySeconds: 60,
	paused: false,
	revision: 'revision-1',
	rpcQuorum: 2,
	selectableOperationAllowlist: ['open-oracle.weth.wrap'],
}

test('a revision bump that leaves a form its own saved fields rebases the draft instead of invalidating it', () => {
	const before = parseConfiguration(saved)
	// Pausing and switching the execution mode bump the revision without touching either form's fields.
	const afterPause = parseConfiguration({ ...saved, execute: true, paused: true, revision: 'revision-2' })
	expect(draftAfterRevisionChange(connectivityScope(before), connectivityScope(afterPause))).toBe('rebase')
	expect(draftAfterRevisionChange(executionPolicyScope(before), executionPolicyScope(afterPause))).toBe('rebase')
	// A catalog toggle rewrites the allowlist: the policy draft is stale, the RPC draft is not.
	const afterSelection = parseConfiguration({ ...saved, revision: 'revision-3', selectableOperationAllowlist: [] })
	expect(draftAfterRevisionChange(executionPolicyScope(before), executionPolicyScope(afterSelection))).toBe('conflict')
	expect(draftAfterRevisionChange(connectivityScope(before), connectivityScope(afterSelection))).toBe('rebase')
	const afterRpcSave = parseConfiguration({ ...saved, connectivity: { ...saved.connectivity, readRpcUrl: 'https://other.example/' }, revision: 'revision-4' })
	expect(draftAfterRevisionChange(connectivityScope(before), connectivityScope(afterRpcSave))).toBe('conflict')
	expect(draftAfterRevisionChange(executionPolicyScope(before), executionPolicyScope(afterRpcSave))).toBe('rebase')
	expect(draftAfterRevisionChange(undefined, connectivityScope(before))).toBe('conflict')
})

test('the complete-configuration draft ignores only the pause state and execution mode', () => {
	const document = { paused: true, runtime: { execute: false, pollMilliseconds: 12_000 }, strategy: { enabledEcosystems: ['zoltar'] } }
	expect(completeConfigurationScope({ ...document, paused: false, runtime: { ...document.runtime, execute: true } })).toBe(completeConfigurationScope(document))
	expect(completeConfigurationScope({ ...document, runtime: { ...document.runtime, pollMilliseconds: 13_000 } })).not.toBe(completeConfigurationScope(document))
})

test('the policy review lists only fields the policy form can change', () => {
	const configuration = parseConfiguration({ ...saved, execute: true })
	const rows = executionPolicyReviewRows(configuration, {
		runtime: { execute: true },
		scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 120 },
		strategy: {
			allowHighRiskOperations: false,
			allowIrreversibleOperations: false,
			enabledEcosystems: ['zoltar', 'trading'],
			initializeGenesisUniverse: false,
			maximumEthPerOperation: '0.05',
			maximumGasCostEth: '0.02',
			maximumRepPerOperation: '10',
			minimumEthReserve: '0.05',
			minimumRepReserve: '10',
			selectableOperationAllowlist: ['open-oracle.weth.wrap'],
			workflowValidForBlocks: 288,
		},
	})
	expect(rows.map(row => row.label)).not.toContain('Execution mode')
	expect(rows).toContainEqual({ label: 'Minimum random delay', before: '60 seconds', after: '120 seconds' })
})

test('retirement blockers and V3 positions are described for the operator', () => {
	const retirement = parsePublicRetirement({
		blockers: [{ category: 'ambiguous-position', details: 'Review the legacy position', nextEligibleAt: 'not-a-date' }, { category: 'pending-transaction' }, 'malformed'],
		positions: [{ fee: 3000, lastCheckedAtBlock: '4242', owner: '0xowner', pool: '0xpool', status: 'needs-collection', tickLower: -120, tickUpper: 120 }, {}],
		status: 'blocked',
	})
	expect(retirement?.blockers.map(retirementBlockerDescription)).toEqual(['ambiguous position: Review the legacy position · next attempt not-a-date', 'pending transaction'])
	expect(retirement?.positions.map(retirementPositionDescription)).toEqual(['needs collection · pool 0xpool · owner 0xowner · ticks -120 to 120 · fee 3000 · checked at block 4242', 'status unavailable'])
})

test('transaction preview values are shown in ETH, not base units', () => {
	expect(stepValueLabel('73')).toBe('0.000000000000000073 ETH')
	expect(stepValueLabel('1500000000000000000')).toBe('1.5 ETH')
	expect(stepValueLabel('0')).toBe('0 ETH')
	expect(stepValueLabel('unparsed')).toBe('unparsed')
})

test('scan age keeps counting past a day', () => {
	const now = Date.parse('2026-10-02T00:00:00Z')
	expect(formatRelative('2026-10-01T22:00:00Z', now)).toBe('Scanned 2h ago')
	expect(formatRelative('2026-09-29T00:00:00Z', now)).toBe('Scanned 3d ago')
})

test('a mutation that never answers delays a refresh only for the bounded wait', async () => {
	const originalFetch = globalThis.fetch
	let release = () => {}
	const answered = new Promise<void>(resolve => {
		release = resolve
	})
	globalThis.fetch = Object.assign(
		async () => {
			await answered
			return Response.json({ saved: true })
		},
		{ preconnect: originalFetch.preconnect },
	)
	try {
		const settledBefore = settledMutations()
		const save = put('/api/settings', {}, 5_000)
		let settled = false
		const wait = mutationsSettled(40).then(() => {
			settled = true
		})
		await Bun.sleep(10)
		expect(settled).toBe(false)
		await wait
		expect(settledMutations()).toBe(settledBefore)
		// A request that changes nothing is never counted, so it cannot hold a refresh back at all.
		const poll = readThroughPut('/api/operation', { action: 'status' }, 5_000)
		release()
		await Promise.all([save, poll])
		expect(settledMutations()).toBe(settledBefore + 1)
		await mutationsSettled(5_000)
	} finally {
		globalThis.fetch = originalFetch
	}
})
