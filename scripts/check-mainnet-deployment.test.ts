import { expect, test } from 'bun:test'
import { assertMainnetDeploymentManifestFresh, renderMarkdown } from './check-mainnet-deployment.mts'

test('mainnet deployment manifest matches the current deterministic deployment calculation', async () => {
	await expect(assertMainnetDeploymentManifestFresh()).resolves.toBeUndefined()
})

test('mainnet deployment markdown preserves protocol config units and meaning', () => {
	const markdown = renderMarkdown({
		protocolConfig: {
			forkBurnDivisor: '5',
			forkThresholdDivisor: '20',
			initialEscalationGameDeposit: '1000000000000000000',
		},
		deploymentSteps: [],
		derivedContracts: [],
	})

	expect(markdown).toContain('| Parameter | Value | Unit / Meaning |')
	expect(markdown).toContain('| initialEscalationGameDeposit | 1000000000000000000 | `1 REP`; constructor-set starting escalation bond from the frozen deployment config. |')
	expect(markdown).not.toContain('`1 REP` in 18-decimal atomic REP units')
})

test('mainnet deployment markdown avoids duplicated atomic REP wording for non-default deposits', () => {
	const markdown = renderMarkdown({
		protocolConfig: {
			forkBurnDivisor: '5',
			forkThresholdDivisor: '20',
			initialEscalationGameDeposit: '2500000000000000000',
		},
		deploymentSteps: [],
		derivedContracts: [],
	})

	expect(markdown).toContain('| initialEscalationGameDeposit | 2500000000000000000 | `2500000000000000000` atomic REP units; constructor-set starting escalation bond from the frozen deployment config. |')
	expect(markdown).not.toContain('atomic REP units` in 18-decimal atomic REP units')
})
