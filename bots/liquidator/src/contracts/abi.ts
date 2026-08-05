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

export const securityPoolFactoryAbi = [
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

export const securityPoolAbi = [
	{
		inputs: [{ name: 'vault', type: 'address' }],
		name: 'securityVaults',
		outputs: [
			{ name: 'repBackingUnits', type: 'uint256' },
			{ name: 'coverageCommitmentAttoEth', type: 'uint256' },
			{ name: 'claimableFeesAttoEth', type: 'uint256' },
			{ name: 'feeIndex', type: 'uint256' },
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'getActiveVaultCount',
		outputs: [{ name: 'count', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'startIndex', type: 'uint256' },
			{ name: 'count', type: 'uint256' },
		],
		name: 'getActiveVaults',
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
		name: 'totalCoverageCommitmentAttoEth',
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
		inputs: [{ name: 'attoRepAmount', type: 'uint256' }],
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

export const securityPoolForkerAbi = [
	{
		inputs: [{ name: 'securityPool', type: 'address' }],
		name: 'forkData',
		outputs: [
			{ name: 'auctionableAttoRepAtFork', type: 'uint256' },
			{ name: 'truthAuction', type: 'address' },
			{ name: 'truthAuctionStarted', type: 'uint256' },
			{ name: 'migratedAttoRep', type: 'uint256' },
			{ name: 'auctionedCoverageCommitmentAttoEth', type: 'uint256' },
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
					{ name: 'initiatorVault', type: 'address' },
					{ name: 'targetVault', type: 'address' },
					{ name: 'operationAmountAttoRepOrAttoEth', type: 'uint256' },
					{ name: 'queuedAt', type: 'uint256' },
					{ name: 'validForSeconds', type: 'uint256' },
					{ name: 'snapshotTargetBackingUnits', type: 'uint256' },
					{ name: 'snapshotTargetCoverageCommitmentAttoEth', type: 'uint256' },
					{ name: 'snapshotTotalPoolHeldAttoRep', type: 'uint256' },
					{ name: 'snapshotTotalRepBackingUnits', type: 'uint256' },
				],
				name: 'operations',
				type: 'tuple[]',
			},
		],
		stateMutability: 'view',
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
			{ indexed: true, name: 'initiatorVault', type: 'address' },
			{ indexed: true, name: 'targetVault', type: 'address' },
			{ indexed: false, name: 'operationAmountAttoRepOrAttoEth', type: 'uint256' },
			{ indexed: false, name: 'queuedAt', type: 'uint256' },
			{ indexed: false, name: 'validForSeconds', type: 'uint256' },
			{ indexed: false, name: 'snapshotTargetBackingUnits', type: 'uint256' },
			{ indexed: false, name: 'snapshotTargetCoverageCommitmentAttoEth', type: 'uint256' },
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
