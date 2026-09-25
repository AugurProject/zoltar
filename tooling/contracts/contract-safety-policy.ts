export type ContractReference = {
	sourcePath: string
	contractName: string
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

const runtimeLimitBytes = 24_576
const initcodeLimitBytes = 49_152

export const contractSafetyPolicy = {
	runtimeLimitBytes,
	initcodeLimitBytes,
	excludedSourcePrefixes: ['contracts/test/', 'contracts/trading/test/'],
	exactLayoutPairs: [
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPool.sol', contractName: 'SecurityPool' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolCoverageDelegate.sol', contractName: 'SecurityPoolCoverageDelegate' },
			reason: 'Assigned coverage operations share the pool ledger through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPool.sol', contractName: 'SecurityPool' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolLiquidationDelegate.sol', contractName: 'SecurityPoolLiquidationDelegate' },
			reason: 'Assigned coverage operations share the pool ledger through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPool.sol', contractName: 'SecurityPool' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolEventEmitter.sol', contractName: 'SecurityPoolEventEmitter' },
			reason: 'Assigned coverage operations share the pool ledger through delegatecall.',
		},
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
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolEventEmitter.sol', contractName: 'SecurityPoolForkEventEmitter' },
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
				{ label: 'activeObligationUnits', slot: '12', offset: 0, typeLabel: 'uint256' },
				{ label: 'uncheckpointedActiveObligationUnits', slot: '13', offset: 0, typeLabel: 'uint256' },
				{ label: 'currentRetentionRate', slot: '14', offset: 0, typeLabel: 'uint256' },
				{ label: 'securityVaults', slot: '16', offset: 0, typeLabel: 'mapping(address => struct SecurityVault)' },
				{ label: 'vaultFeeRemainders', slot: '17', offset: 0, typeLabel: 'mapping(uint256 => mapping(address => uint256))' },
			],
		},
	] satisfies readonly AnchoredLayout[],
} as const
