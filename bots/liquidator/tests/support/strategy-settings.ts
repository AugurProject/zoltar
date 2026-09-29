/** Stored strategy settings from the operator example: automatic vault management on, pool creation left to its default. */
export function storedStrategyFixture() {
	return {
		allowAutomaticDeposits: true,
		allowAutomaticVaultMigrations: true,
		allowAutomaticWithdrawals: true,
		candidatePriority: 'largest-bonus',
		fallbackRepPerEthPrice: '0',
		maximumGasCostEth: '0.02',
		maximumLiquidationDebtEth: '25',
		maximumOracleRequestCostEth: '0.02',
		maximumPerPoolRep: '10000',
		maximumTotalDeployedRep: '25000',
		minimumLiquidationDebtEth: '1',
		minimumRepWithdrawalRep: '10',
		minimumRewardValueEth: '0.02',
		redeemFeesAboveEth: '0.01',
		stalePriceFundingBufferBps: 15_000,
		stagedOperationValidForSeconds: 240,
		vaultTargetHealthBps: 12_500,
		vaultTopUpHealthBps: 11_000,
		vaultWithdrawHealthBps: 15_000,
		walletReserveRep: '100',
	}
}
