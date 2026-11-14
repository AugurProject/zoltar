/** Saved strategy settings the dashboard fixture servers report: every ecosystem enabled under the default spend and reserve limits. */
export const dashboardFixtureStrategy = (selectableOperationAllowlist: string[]) => ({
	allowHighRiskOperations: false,
	allowIrreversibleOperations: false,
	initializeGenesisUniverse: true,
	enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
	maximumEthPerOperation: '0.05',
	maximumGasCostEth: '0.02',
	maximumRepPerOperation: '10',
	minimumEthReserve: '0.05',
	minimumRepReserve: '10',
	selectableOperationAllowlist,
	workflowValidForBlocks: 288,
})
