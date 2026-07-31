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
	{ name: 'initialReportPriorityFeeWeiPerGas', type: 'uint256' },
	{ name: 'currentRetentionRate', type: 'uint256' },
	{ name: 'completeSetCollateralAmount', type: 'uint256' },
] as const

export const securityPoolFactoryAbi = [
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
			{ name: 'poolOwnership', type: 'uint256' },
			{ name: 'securityBondAllowance', type: 'uint256' },
			{ name: 'unpaidEthFees', type: 'uint256' },
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
		name: 'getTotalRepBalance',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'poolOwnershipDenominator',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'completeSetCollateralAmount',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'totalSecurityBondAllowance',
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
		inputs: [{ name: 'repAmount', type: 'uint256' }],
		name: 'depositRep',
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
			{ name: 'auctionableRepAtFork', type: 'uint256' },
			{ name: 'truthAuction', type: 'address' },
			{ name: 'truthAuctionStarted', type: 'uint256' },
			{ name: 'migratedRep', type: 'uint256' },
			{ name: 'auctionedSecurityBondAllowance', type: 'uint256' },
			{ name: 'escalationElapsedAtFork', type: 'uint256' },
			{ name: 'escalationStartBondAtFork', type: 'uint256' },
			{ name: 'escalationNonDecisionThresholdAtFork', type: 'uint256' },
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
					{ name: 'amount', type: 'uint256' },
					{ name: 'queuedAt', type: 'uint256' },
					{ name: 'validForSeconds', type: 'uint256' },
					{ name: 'snapshotTargetOwnership', type: 'uint256' },
					{ name: 'snapshotTargetAllowance', type: 'uint256' },
					{ name: 'snapshotTotalRep', type: 'uint256' },
					{ name: 'snapshotDenominator', type: 'uint256' },
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
		name: 'getRequestPriceEthCost',
		outputs: [{ name: 'cost', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [],
		name: 'minimumToken1Report',
		outputs: [{ name: 'amount', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'operation', type: 'uint8' },
			{ name: 'targetVault', type: 'address' },
			{ name: 'amount', type: 'uint256' },
			{ name: 'validForSeconds', type: 'uint256' },
			{ name: 'proposedRepPerEthPrice', type: 'uint256' },
			{ name: 'requestedInitialWeth', type: 'uint256' },
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
			{ indexed: false, name: 'amount', type: 'uint256' },
			{ indexed: false, name: 'queuedAt', type: 'uint256' },
			{ indexed: false, name: 'validForSeconds', type: 'uint256' },
			{ indexed: false, name: 'snapshotTargetOwnership', type: 'uint256' },
			{ indexed: false, name: 'snapshotTargetAllowance', type: 'uint256' },
			{ indexed: false, name: 'snapshotTotalRep', type: 'uint256' },
			{ indexed: false, name: 'snapshotDenominator', type: 'uint256' },
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
