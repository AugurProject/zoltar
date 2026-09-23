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

const runtimeLimitBytes = 24_576
const initcodeLimitBytes = 49_152

function runtimeBudget(reference: ContractReference, maximumBytes: number, context: string): BytecodeBudget {
	return {
		...reference,
		maximumBytes,
		reason: `${context} The current runtime leaves ${runtimeLimitBytes - maximumBytes} bytes of EIP-170 headroom.`,
	}
}

function initcodeBudget(reference: ContractReference, maximumBytes: number, context: string): BytecodeBudget {
	return {
		...reference,
		maximumBytes,
		reason: `${context} The current minimum initcode leaves ${initcodeLimitBytes - maximumBytes} bytes of EIP-3860 headroom.`,
	}
}

export const contractSafetyPolicy = {
	runtimeLimitBytes,
	initcodeLimitBytes,
	excludedSourcePrefixes: ['contracts/test/', 'contracts/trading/test/'],
	// Contracts close to protocol deployment limits have explicit no-growth budgets.
	// Raising one requires a reviewed reason in the same change.
	runtimeBudgets: [
		runtimeBudget(
			{
				sourcePath: 'contracts/statoblast/SecurityPool.sol',
				contractName: 'SecurityPool',
			},
			24_371,
			'The reviewed pool stores vault targets and delegates fee checkpoints while retaining the size-limited initialization guard; no further runtime growth is permitted.',
		),
		runtimeBudget(
			{
				sourcePath: 'contracts/statoblast/EscalationGame.sol',
				contractName: 'EscalationGame',
			},
			24_503,
			'The game adds fork-aware finality to preserve unresolved carry during delayed migration, sharing the fork-time lookup with payout calculation to bound the 75-byte runtime increase; no further runtime growth is permitted.',
		),
		runtimeBudget(
			{
				sourcePath: 'contracts/statoblast/OpenOraclePriceCoordinator.sol',
				contractName: 'OpenOraclePriceCoordinator',
			},
			24_050,
			'The reviewed coordinator takes an explicit request bounty and derives the settlement base-fee cap from it so fee-free simulations match mined gas and ETH movement; no further runtime growth is permitted.',
		),
		runtimeBudget(
			{
				sourcePath: 'contracts/statoblast/SecurityPoolForker.sol',
				contractName: 'SecurityPoolForker',
			},
			24_046,
			'The forker delegates finality to the game and preserves fractional truth-auction backing without duplicated checks; no further runtime growth is permitted.',
		),
	] satisfies readonly BytecodeBudget[],
	initcodeBudgets: [
		initcodeBudget(
			{
				sourcePath: 'contracts/statoblast/SecurityPoolForker.sol',
				contractName: 'SecurityPoolForker',
			},
			48_298,
			'The forker initcode reflects shared game finality and proportional auction backing; no further growth is permitted.',
		),
		initcodeBudget(
			{
				sourcePath: 'contracts/statoblast/factories/EscalationGameFactory.sol',
				contractName: 'EscalationGameFactory',
			},
			46_755,
			'The factory embeds the game with fork-aware finality, increasing minimum initcode by 82 bytes to preserve unresolved carry during delayed migration; no further growth is permitted.',
		),
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
				{ label: 'feeEligibleCapacityOwnershipAttoRep', slot: '12', offset: 0, typeLabel: 'uint256' },
				{ label: 'uncheckpointedFeeEligibleCapacityOwnershipAttoRep', slot: '13', offset: 0, typeLabel: 'uint256' },
				{ label: 'currentRetentionRate', slot: '14', offset: 0, typeLabel: 'uint256' },
				{ label: 'securityVaults', slot: '16', offset: 0, typeLabel: 'mapping(address => struct SecurityVault)' },
				{ label: 'vaultFeeRemainders', slot: '17', offset: 0, typeLabel: 'mapping(address => uint256)' },
			],
		},
	] satisfies readonly AnchoredLayout[],
} as const
