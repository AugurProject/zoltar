import type { Configuration } from './dashboard-data.ts'

export type ExecutionPolicyPatch = {
	runtime: { execute: boolean }
	scheduler: { maximumDelaySeconds: number; minimumDelaySeconds: number }
	strategy: {
		allowHighRiskOperations: boolean
		allowIrreversibleOperations: boolean
		initializeGenesisUniverse: boolean
		enabledEcosystems: string[]
		maximumEthPerOperation: string
		maximumGasCostEth: string
		maximumRepPerOperation: string
		minimumEthReserve: string
		minimumRepReserve: string
		selectableOperationAllowlist: string[] | null
		workflowValidForBlocks: number
	}
}

function allowlistSummary(selection: string[] | null | undefined) {
	if (selection === null || selection === undefined) return 'All selectable operations'
	if (selection.length === 0) return 'None'
	return selection.join(', ')
}

/** Every field in the submitted policy patch has a matching review row. */
export function executionPolicyReviewRows(configuration: Configuration, patch: ExecutionPolicyPatch) {
	const { scheduler, strategy } = patch
	return [
		{ label: 'Execution mode', before: configuration.execute === true ? 'Live armed' : 'Dry run', after: patch.runtime.execute ? 'Live armed' : 'Dry run' },
		{ label: 'Minimum random delay', before: `${configuration.minimumDelaySeconds ?? '—'} seconds`, after: `${scheduler.minimumDelaySeconds} seconds` },
		{ label: 'Maximum random delay', before: `${configuration.maximumDelaySeconds ?? '—'} seconds`, after: `${scheduler.maximumDelaySeconds} seconds` },
		{ label: 'High-risk operations', before: configuration.allowHighRiskOperations === true ? 'Allowed' : 'Blocked', after: strategy.allowHighRiskOperations ? 'Allowed' : 'Blocked' },
		{ label: 'Irreversible operations', before: configuration.allowIrreversibleOperations === true ? 'Allowed' : 'Blocked', after: strategy.allowIrreversibleOperations ? 'Allowed' : 'Blocked' },
		{ label: 'Genesis initialization', before: configuration.initializeGenesisUniverse === true ? 'Enabled' : 'Disabled', after: strategy.initializeGenesisUniverse ? 'Enabled' : 'Disabled' },
		{ label: 'Enabled ecosystems', before: configuration.enabledEcosystems.join(', '), after: strategy.enabledEcosystems.join(', ') },
		{ label: 'Selectable operation allowlist', before: allowlistSummary(configuration.selectableOperationAllowlist), after: allowlistSummary(strategy.selectableOperationAllowlist) },
		{ label: 'Maximum ETH / operation', before: `${configuration.maximumEthPerOperation ?? '—'} ETH`, after: `${strategy.maximumEthPerOperation} ETH` },
		{ label: 'Maximum gas cost', before: `${configuration.maximumGasCostEth ?? '—'} ETH`, after: `${strategy.maximumGasCostEth} ETH` },
		{ label: 'Maximum REP / operation', before: `${configuration.maximumRepPerOperation ?? '—'} REP`, after: `${strategy.maximumRepPerOperation} REP` },
		{ label: 'ETH reserve', before: `${configuration.minimumEthReserve ?? '—'} ETH`, after: `${strategy.minimumEthReserve} ETH` },
		{ label: 'REP reserve', before: `${configuration.minimumRepReserve ?? '—'} REP`, after: `${strategy.minimumRepReserve} REP` },
		{ label: 'Workflow validity', before: `${configuration.workflowValidForBlocks ?? '—'} blocks`, after: `${strategy.workflowValidForBlocks} blocks` },
	].filter(change => change.before !== change.after)
}
