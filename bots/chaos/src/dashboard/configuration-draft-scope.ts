import type { Configuration } from './dashboard-data.ts'

// Every dashboard save bumps the one configuration revision. A draft is only invalidated when the saved values of the
// fields its own form edits changed; a revision bump from pausing, another panel, or a catalog toggle rebases it.

/** The saved values the RPC connectivity form edits. */
export function connectivityScope(configuration: Configuration) {
	return JSON.stringify([configuration.connectivity?.readRpcUrl ?? '', configuration.connectivity?.quorumRpcUrls ?? [], configuration.connectivity?.publicRpcUrls ?? [], String(configuration.rpcQuorum ?? '')])
}

/** The saved values the execution policy form edits. */
export function executionPolicyScope(configuration: Configuration) {
	return JSON.stringify([
		configuration.allowHighRiskOperations === true,
		configuration.allowIrreversibleOperations === true,
		configuration.initializeGenesisUniverse === true,
		configuration.selectableOperationAllowlist ?? null,
		String(configuration.minimumDelaySeconds ?? ''),
		String(configuration.maximumDelaySeconds ?? ''),
		String(configuration.minimumEthReserve ?? ''),
		String(configuration.minimumRepReserve ?? ''),
		String(configuration.maximumEthPerOperation ?? ''),
		String(configuration.maximumGasCostEth ?? ''),
		String(configuration.maximumRepPerOperation ?? ''),
		String(configuration.workflowValidForBlocks ?? ''),
		[...configuration.enabledEcosystems].sort(),
	])
}

/**
 * The complete-configuration document without the fields its editor never shows, which change through their own
 * controls: the pause state and the execution mode.
 */
export function completeConfigurationScope(settings: unknown) {
	return JSON.stringify(settings, (key, value: unknown) => {
		if (key === 'paused' || key === 'execute' || key === 'privateKey') return undefined
		return value
	})
}

/** What a dirty draft does when the configuration revision moved under it. */
export function draftAfterRevisionChange(draftScope: string | undefined, currentScope: string): 'conflict' | 'rebase' {
	return draftScope !== undefined && draftScope === currentScope ? 'rebase' : 'conflict'
}
