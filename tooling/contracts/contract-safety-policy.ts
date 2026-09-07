export type ContractReference = {
	sourcePath: string
	contractName: string
}

export type BytecodeBudget = ContractReference & {
	maximumBytes: number
	reason: string
}

export type ExactLayoutPair = {
	host: ContractReference
	delegate: ContractReference
	reason: string
}

type StorageAnchor = {
	label: string
	slot: string
	offset: number
	typeLabel: string
}

export type AnchoredLayout = {
	host: ContractReference
	consumer: ContractReference
	anchors: readonly StorageAnchor[]
	reason: string
}

export const contractSafetyPolicy = {
	runtimeLimitBytes: 24_576,
	initcodeLimitBytes: 49_152,
	excludedSourcePrefixes: ['contracts/test/', 'contracts/trading/test/'],
	// Contracts close to protocol deployment limits have explicit no-growth budgets.
	// Raising one requires a reviewed reason in the same change.
	runtimeBudgets: [
		{
			sourcePath: 'contracts/statoblast/SecurityPool.sol',
			contractName: 'SecurityPool',
			maximumBytes: 24_554,
			reason: 'Only 22 bytes of EIP-170 headroom remain.',
		},
		{
			sourcePath: 'contracts/statoblast/EscalationGame.sol',
			contractName: 'EscalationGame',
			maximumBytes: 24_286,
			reason: 'The reviewed 59-byte growth dispatches the two narrowly scoped atomic REP authorization deposit entrypoints; 290 bytes of EIP-170 headroom remain.',
		},
		{
			sourcePath: 'contracts/statoblast/OpenOraclePriceCoordinator.sol',
			contractName: 'OpenOraclePriceCoordinator',
			maximumBytes: 24_129,
			reason: 'The runtime is above 98% of the EIP-170 limit.',
		},
		{
			sourcePath: 'contracts/statoblast/SecurityPoolForker.sol',
			contractName: 'SecurityPoolForker',
			maximumBytes: 24_014,
			reason: 'The runtime is above 97% of the EIP-170 limit.',
		},
	] satisfies readonly BytecodeBudget[],
	initcodeBudgets: [
		{
			sourcePath: 'contracts/statoblast/SecurityPoolForker.sol',
			contractName: 'SecurityPoolForker',
			maximumBytes: 49_122,
			reason: 'Only 30 bytes of EIP-3860 headroom remain after the constructor argument.',
		},
		{
			sourcePath: 'contracts/statoblast/factories/EscalationGameFactory.sol',
			contractName: 'EscalationGameFactory',
			maximumBytes: 46_137,
			reason: 'The factory embeds the reviewed, question-bound atomic-authorization EscalationGame creation code; 3,015 bytes of EIP-3860 headroom remain.',
		},
	] satisfies readonly BytecodeBudget[],
	exactLayoutPairs: [
		{
			host: { sourcePath: 'contracts/statoblast/EscalationGame.sol', contractName: 'EscalationGame' },
			delegate: { sourcePath: 'contracts/statoblast/EscalationGameDepositDelegate.sol', contractName: 'EscalationGameDepositDelegate' },
			reason: 'Deposits mutate EscalationGame storage through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/EscalationGame.sol', contractName: 'EscalationGame' },
			delegate: { sourcePath: 'contracts/statoblast/EscalationGameClaimDelegate.sol', contractName: 'EscalationGameClaimDelegate' },
			reason: 'Claim accounting reads and mutates EscalationGame storage through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPool.sol', contractName: 'SecurityPool' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolSettlementDelegate.sol', contractName: 'SecurityPoolSettlementDelegate' },
			reason: 'Settlement operations mutate SecurityPool storage through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPool.sol', contractName: 'SecurityPool' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolOperationsDelegate.sol', contractName: 'SecurityPoolOperationsDelegate' },
			reason: 'Vault operations mutate SecurityPool storage through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPoolForker.sol', contractName: 'SecurityPoolForker' },
			delegate: {
				sourcePath: 'contracts/statoblast/SecurityPoolForkerVaultMigrationDelegate.sol',
				contractName: 'SecurityPoolForkerVaultMigrationDelegate',
			},
			reason: 'Vault migration mutates SecurityPoolForker storage through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPoolForker.sol', contractName: 'SecurityPoolForker' },
			delegate: { sourcePath: 'contracts/statoblast/EscalationGameForker.sol', contractName: 'EscalationGameForker' },
			reason: 'Escalation migration mutates SecurityPoolForker storage through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPoolForker.sol', contractName: 'SecurityPoolForker' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolEventEmitter.sol', contractName: 'SecurityPoolEventEmitter' },
			reason: 'Fork event emission reads SecurityPoolForker storage through delegatecall.',
		},
	] satisfies readonly ExactLayoutPair[],
	anchoredLayouts: [
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPool.sol', contractName: 'SecurityPool' },
			consumer: { sourcePath: 'contracts/statoblast/SecurityPoolEventEmitter.sol', contractName: 'SecurityPoolEventEmitter' },
			reason: 'Pool accounting events read these SecurityPool slots directly in assembly.',
			anchors: [
				{ label: 'totalCapacityOwnershipAttoRep', slot: '1', offset: 0, typeLabel: 'uint256' },
				{ label: 'settlementCollateralAttoEth', slot: '2', offset: 0, typeLabel: 'uint256' },
				{ label: 'totalRepBackingUnits', slot: '3', offset: 0, typeLabel: 'uint256' },
				{ label: 'totalClaimableVaultFeesAttoEth', slot: '6', offset: 0, typeLabel: 'uint256' },
				{ label: 'lastUpdatedFeeAccumulator', slot: '7', offset: 0, typeLabel: 'uint256' },
				{ label: 'feeIndex', slot: '8', offset: 0, typeLabel: 'uint256' },
				{ label: 'feeIndexRemainder', slot: '9', offset: 0, typeLabel: 'uint256' },
				{ label: 'totalFeesOwedRemainder', slot: '10', offset: 0, typeLabel: 'uint256' },
				{ label: 'unallocatedAccruedFeesAttoEth', slot: '11', offset: 0, typeLabel: 'uint256' },
				{ label: 'feeEligibleCapacityOwnershipAttoRep', slot: '12', offset: 0, typeLabel: 'uint256' },
				{ label: 'uncheckpointedFeeEligibleCapacityOwnershipAttoRep', slot: '13', offset: 0, typeLabel: 'uint256' },
				{ label: 'currentRetentionRate', slot: '14', offset: 0, typeLabel: 'uint256' },
				{ label: 'securityVaults', slot: '16', offset: 0, typeLabel: 'mapping(address => struct SecurityVault)' },
				{ label: 'vaultFeeRemainders', slot: '17', offset: 0, typeLabel: 'mapping(address => uint256)' },
			],
		},
	] satisfies readonly AnchoredLayout[],
} as const
