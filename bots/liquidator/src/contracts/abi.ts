export const erc20Abi = [
	{
		inputs: [{ name: 'owner', type: 'address' }],
		name: 'balanceOf',
		outputs: [{ name: 'balance', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'spender', type: 'address' },
		],
		name: 'allowance',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		name: 'approve',
		outputs: [{ name: 'success', type: 'bool' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const

const deploymentComponents = [
	{ name: 'securityPool', type: 'address' },
	{ name: 'truthAuction', type: 'address' },
	{ name: 'priceOracleManagerAndOperatorQueuer', type: 'address' },
	{ name: 'shareToken', type: 'address' },
	{ name: 'parent', type: 'address' },
	{ name: 'universeId', type: 'uint248' },
	{ name: 'questionId', type: 'uint256' },
	{ name: 'statoblastSecurityMultiplierBps', type: 'uint256' },
	{ name: 'initialReportPriorityFeeAttoEthPerGas', type: 'uint256' },
	{ name: 'currentRetentionRate', type: 'uint256' },
	{ name: 'settlementCollateralAttoEth', type: 'uint256' },
] as const

export const deploySecurityPoolEvent = {
	type: 'event',
	name: 'DeploySecurityPool',
	inputs: [
		{ indexed: true, name: 'securityPool', type: 'address' },
		{ indexed: false, name: 'truthAuction', type: 'address' },
		{ indexed: false, name: 'priceOracleManagerAndOperatorQueuer', type: 'address' },
		{ indexed: false, name: 'shareToken', type: 'address' },
		{ indexed: true, name: 'parent', type: 'address' },
		{ indexed: true, name: 'universeId', type: 'uint248' },
		{ indexed: false, name: 'questionId', type: 'uint256' },
		{ indexed: false, name: 'statoblastSecurityMultiplierBps', type: 'uint256' },
		{ indexed: false, name: 'initialReportPriorityFeeAttoEthPerGas', type: 'uint256' },
		{ indexed: false, name: 'currentRetentionRate', type: 'uint256' },
		{ indexed: false, name: 'settlementCollateralAttoEth', type: 'uint256' },
	],
} as const

export const securityPoolFactoryAbi = [
	deploySecurityPoolEvent,
	{
		inputs: [
			{ name: 'originUniverseId', type: 'uint248' },
			{ name: 'questionId', type: 'uint256' },
			{ name: 'statoblastSecurityMultiplierBps', type: 'uint256' },
			{ name: 'initialReportPriorityFeeAttoEthPerGas', type: 'uint256' },
		],
		name: 'getOriginId',
		outputs: [{ name: 'originId', type: 'bytes32' }],
		stateMutability: 'pure',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'originId', type: 'bytes32' },
			{ name: 'universeId', type: 'uint248' },
		],
		name: 'getSecurityPool',
		outputs: [{ name: 'securityPool', type: 'address' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'universeId', type: 'uint248' },
			{ name: 'questionId', type: 'uint256' },
			{ name: 'statoblastSecurityMultiplierBps', type: 'uint256' },
			{ name: 'initialReportPriorityFeeAttoEthPerGas', type: 'uint256' },
		],
		name: 'deployOriginSecurityPool',
		outputs: [{ name: 'securityPool', type: 'address' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [],
		name: 'securityPoolDeploymentCount',
		outputs: [{ name: 'count', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'startIndex', type: 'uint256' },
			{ name: 'count', type: 'uint256' },
		],
		name: 'securityPoolDeploymentsRange',
		outputs: [{ components: deploymentComponents, name: 'deployments', type: 'tuple[]' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const

const universeComponents = [
	{ name: 'forkTime', type: 'uint256' },
	{ name: 'forkQuestionId', type: 'uint256' },
	{ name: 'forkingOutcomeIndex', type: 'uint256' },
	{ name: 'reputationToken', type: 'address' },
	{ name: 'parentUniverseId', type: 'uint248' },
] as const

export const zoltarAbi = [
	{
		inputs: [{ name: 'universeId', type: 'uint248' }],
		name: 'universes',
		outputs: universeComponents,
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'universeId', type: 'uint248' },
			{ name: 'startIndex', type: 'uint256' },
			{ name: 'count', type: 'uint256' },
		],
		name: 'getDeployedChildUniverses',
		outputs: [
			{ name: 'outcomeIndexes', type: 'uint256[]' },
			{ name: 'childUniverseIds', type: 'uint248[]' },
			{ components: universeComponents, name: 'childUniverses', type: 'tuple[]' },
		],
		stateMutability: 'view',
		type: 'function',
	},
] as const

export const vaultAccountingCheckpointEvent = {
	inputs: [
		{ indexed: true, name: 'vault', type: 'address' },
		{ indexed: false, name: 'repBackingUnits', type: 'uint256' },
		{ indexed: false, name: 'capacityOwnershipAttoRep', type: 'uint256' },
		{ indexed: false, name: 'claimableFeesAttoEth', type: 'uint256' },
		{ indexed: false, name: 'feeIndex', type: 'uint256' },
		{ indexed: false, name: 'vaultFeeRemainder', type: 'uint256' },
		{ indexed: false, name: 'resultingTotalRepBackingUnits', type: 'uint256' },
		{ indexed: false, name: 'resultingFeeEligibleCapacityOwnershipAttoRep', type: 'uint256' },
	],
	name: 'VaultAccountingCheckpoint',
	type: 'event',
} as const

export const vaultEscrowUpdatedEvent = {
	inputs: [
		{ indexed: true, name: 'vault', type: 'address' },
		{ indexed: false, name: 'disputeStakedRepByVaultAttoRep', type: 'uint256' },
		{ indexed: false, name: 'totalDisputeStakedAttoRep', type: 'uint256' },
	],
	name: 'VaultEscrowUpdated',
	type: 'event',
} as const

export const securityPoolAbi = [
	vaultAccountingCheckpointEvent,
	{
		inputs: [],
		name: 'escalationGame',
		outputs: [{ name: '', type: 'address' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [{ name: 'vault', type: 'address' }],
		name: 'securityVaults',
		outputs: [
			{ name: 'repBackingUnits', type: 'uint256' },
			{ name: 'capacityOwnershipAttoRep', type: 'uint256' },
			{ name: 'claimableFeesAttoEth', type: 'uint256' },
			{ name: 'feeIndex', type: 'uint256' },
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'getVaultCount',
		outputs: [{ name: 'count', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'startIndex', type: 'uint256' },
			{ name: 'count', type: 'uint256' },
		],
		name: 'getVaults',
		outputs: [{ name: 'vaults', type: 'address[]' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'getTotalPoolHeldAttoRep',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'totalRepBackingUnits',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'settlementCollateralAttoEth',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'totalCapacityOwnershipAttoRep',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'getPoolAccountingSnapshot',
		outputs: [
			{
				components: [
					{ name: 'settlementCollateralAttoEth', type: 'uint256' },
					{ name: 'totalCapacityOwnershipAttoRep', type: 'uint256' },
					{ name: 'feeEligibleCapacityOwnershipAttoRep', type: 'uint256' },
					{ name: 'totalClaimableVaultFeesAttoEth', type: 'uint256' },
					{ name: 'unallocatedAccruedFeesAttoEth', type: 'uint256' },
					{ name: 'feeIndex', type: 'uint256' },
					{ name: 'feeIndexRemainder', type: 'uint256' },
					{ name: 'totalFeesOwedRemainder', type: 'uint256' },
					{ name: 'uncheckpointedFeeEligibleCapacityOwnershipAttoRep', type: 'uint256' },
					{ name: 'lastUpdatedFeeAccumulator', type: 'uint256' },
					{ name: 'currentRetentionRate', type: 'uint256' },
				],
				name: 'snapshot',
				type: 'tuple',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [{ name: 'vault', type: 'address' }],
		name: 'getVaultOpenInterestAttoEth',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [{ name: 'vault', type: 'address' }],
		name: 'vaultBadDebtAttoEth',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'minimumSecurityBondDebtAttoEth',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'minimumVaultRepDepositAttoRep',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'currentRetentionRate',
		outputs: [{ name: 'rate', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'systemState',
		outputs: [{ name: 'state', type: 'uint8' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'repToken',
		outputs: [{ name: 'token', type: 'address' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'securityPoolForker',
		outputs: [{ name: 'forker', type: 'address' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'attoRepAmount', type: 'uint256' },
			{ name: 'targetHealthFactorBps', type: 'uint256' },
		],
		name: 'depositRepToVault',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [{ name: 'vault', type: 'address' }],
		name: 'redeemFees',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const

export const escalationGameAbi = [
	vaultEscrowUpdatedEvent,
	{
		inputs: [{ name: 'vault', type: 'address' }],
		name: 'disputeStakedRepByVaultAttoRep',
		outputs: [{ name: 'amountAttoRep', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const

export const securityPoolForkerAbi = [
	{
		inputs: [{ name: 'securityPool', type: 'address' }],
		name: 'forkData',
		outputs: [
			{ name: 'auctionableAttoRepAtFork', type: 'uint256' },
			{ name: 'truthAuction', type: 'address' },
			{ name: 'truthAuctionStarted', type: 'uint256' },
			{ name: 'migratedAttoRep', type: 'uint256' },
			{ name: 'auctionedCapacityOwnershipAttoRep', type: 'uint256' },
			{ name: 'escalationElapsedAtFork', type: 'uint256' },
			{ name: 'escalationStartBondAtForkAttoRep', type: 'uint256' },
			{ name: 'escalationNonDecisionThresholdAtForkAttoRep', type: 'uint256' },
			{ name: 'ownFork', type: 'bool' },
			{ name: 'unresolvedEscalationAtFork', type: 'bool' },
			{ name: 'outcomeIndex', type: 'uint256' },
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [{ name: 'securityPool', type: 'address' }],
		name: 'getForkActivationTime',
		outputs: [{ name: 'timestamp', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'securityPool', type: 'address' },
			{ name: 'outcomeIndex', type: 'uint256' },
		],
		name: 'migrateVault',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const

export const coordinatorAbi = [
	{
		inputs: [],
		name: 'getActiveStagedOperationCount',
		outputs: [{ name: 'count', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'startIndex', type: 'uint256' },
			{ name: 'count', type: 'uint256' },
		],
		name: 'getActiveStagedOperations',
		outputs: [
			{ name: 'operationIds', type: 'uint256[]' },
			{
				components: [
					{ name: 'operation', type: 'uint8' },
					{ name: 'operator', type: 'address' },
					{ name: 'receiverVault', type: 'address' },
					{ name: 'targetVault', type: 'address' },
					{ name: 'operationAmountAttoRepOrAttoEth', type: 'uint256' },
					{ name: 'queuedAt', type: 'uint256' },
					{ name: 'validForSeconds', type: 'uint256' },
					{ name: 'snapshotTargetBackingUnits', type: 'uint256' },
					{ name: 'snapshotTargetCapacityOwnershipAttoRep', type: 'uint256' },
					{ name: 'snapshotTargetOpenInterestAttoEth', type: 'uint256' },
					{ name: 'snapshotTargetDisputeStakedAttoRep', type: 'uint256' },
					{ name: 'snapshotTotalPoolHeldAttoRep', type: 'uint256' },
					{ name: 'snapshotTotalRepBackingUnits', type: 'uint256' },
					{ name: 'liquidationApprovalId', type: 'bytes32' },
					{ name: 'reservedLiquidationDebtAttoEth', type: 'uint256' },
				],
				name: 'operations',
				type: 'tuple[]',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'targetVault', type: 'address' },
			{ name: 'receiverVault', type: 'address' },
			{ name: 'requestedDebtAttoEth', type: 'uint256' },
			{ name: 'approvalId', type: 'bytes32' },
			{ name: 'validForSeconds', type: 'uint256' },
			{ name: 'proposedRepPerEthPrice', type: 'uint256' },
			{ name: 'requestedInitialAttoWeth', type: 'uint256' },
		],
		name: 'requestPriceIfNeededAndStageLiquidation',
		outputs: [],
		stateMutability: 'payable',
		type: 'function',
	},
	{
		inputs: [],
		name: 'getPendingSettlementOperationIds',
		outputs: [{ name: 'operationIds', type: 'uint256[]' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'minLiquidationPriceDistanceBps',
		outputs: [{ name: 'distanceBps', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'lastPrice',
		outputs: [{ name: 'price', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'lastSettlementTimestamp',
		outputs: [{ name: 'timestamp', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'isPriceValid',
		outputs: [{ name: 'valid', type: 'bool' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'pendingReportId',
		outputs: [{ name: 'reportId', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'pendingReportSponsor',
		outputs: [{ name: 'sponsor', type: 'address' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'getRequestPriceCostAttoEth',
		outputs: [{ name: 'cost', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'minimumToken1ReportAttoEth',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'operation', type: 'uint8' },
			{ name: 'targetVault', type: 'address' },
			{ name: 'operationAmountAttoRepOrAttoEth', type: 'uint256' },
			{ name: 'validForSeconds', type: 'uint256' },
			{ name: 'proposedRepPerEthPrice', type: 'uint256' },
			{ name: 'requestedInitialAttoWeth', type: 'uint256' },
		],
		name: 'requestPriceIfNeededAndStageOperation',
		outputs: [],
		stateMutability: 'payable',
		type: 'function',
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: 'operationId', type: 'uint256' },
			{ indexed: false, name: 'operation', type: 'uint8' },
		],
		name: 'PendingOperationRecoveryConsumed',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: 'operationId', type: 'uint256' },
			{ indexed: false, name: 'operation', type: 'uint8' },
			{ indexed: true, name: 'operator', type: 'address' },
			{ indexed: true, name: 'targetVault', type: 'address' },
			{ indexed: false, name: 'operationAmountAttoRepOrAttoEth', type: 'uint256' },
			{ indexed: false, name: 'queuedAt', type: 'uint256' },
			{ indexed: false, name: 'validForSeconds', type: 'uint256' },
			{ indexed: false, name: 'snapshotTargetBackingUnits', type: 'uint256' },
			{ indexed: false, name: 'snapshotTargetCapacityOwnershipAttoRep', type: 'uint256' },
			{ indexed: false, name: 'snapshotTargetOpenInterestAttoEth', type: 'uint256' },
			{ indexed: false, name: 'snapshotTargetDisputeStakedAttoRep', type: 'uint256' },
			{ indexed: false, name: 'snapshotTotalPoolHeldAttoRep', type: 'uint256' },
			{ indexed: false, name: 'snapshotTotalRepBackingUnits', type: 'uint256' },
			{ indexed: false, name: 'isPendingSlot', type: 'bool' },
		],
		name: 'StagedOperationQueued',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: 'operationId', type: 'uint256' },
			{ indexed: true, name: 'operator', type: 'address' },
			{ indexed: true, name: 'receiverVault', type: 'address' },
			{ indexed: false, name: 'targetVault', type: 'address' },
			{ indexed: false, name: 'approvalId', type: 'bytes32' },
			{ indexed: false, name: 'requestedDebtAttoEth', type: 'uint256' },
			{ indexed: false, name: 'reservedDebtAttoEth', type: 'uint256' },
		],
		name: 'LiquidationRouteStaged',
		type: 'event',
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: 'operationId', type: 'uint256' },
			{ indexed: false, name: 'operation', type: 'uint8' },
			{ indexed: false, name: 'success', type: 'bool' },
			{ indexed: false, name: 'errorMessage', type: 'string' },
		],
		name: 'ExecutedStagedOperation',
		type: 'event',
	},
] as const

export const wethAbi = [
	...erc20Abi,
	{
		inputs: [],
		name: 'deposit',
		outputs: [],
		stateMutability: 'payable',
		type: 'function',
	},
] as const
