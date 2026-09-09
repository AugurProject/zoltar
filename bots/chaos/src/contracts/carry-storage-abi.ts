const carryLeafComponents = [
	{ name: 'depositor', type: 'address' },
	{ name: 'amountAttoRep', type: 'uint256' },
	{ name: 'parentDepositIndex', type: 'uint256' },
	{ name: 'cumulativeAmountAttoRep', type: 'uint256' },
	{ name: 'sourceNodeId', type: 'uint256' },
] as const

export const carryStorageAbi = [
	{
		type: 'function',
		name: 'nodes',
		stateMutability: 'view',
		inputs: [{ name: '', type: 'uint256' }],
		outputs: [
			{ name: 'parentNodeId', type: 'uint256' },
			{ name: 'depositor', type: 'address' },
			{ name: 'outcome', type: 'uint8' },
			{ name: 'amountAttoRep', type: 'uint256' },
			{ name: 'parentDepositIndex', type: 'uint256' },
			{ name: 'cumulativeAmountAttoRep', type: 'uint256' },
			{ name: 'carryLeafIndex', type: 'uint256' },
		],
	},
	{
		type: 'function',
		name: 'getCarryLeafPageByOutcome',
		stateMutability: 'view',
		inputs: [
			{ name: 'outcome', type: 'uint8' },
			{ name: 'startNodeId', type: 'uint256' },
			{ name: 'maxEntries', type: 'uint256' },
		],
		outputs: [
			{ name: 'carryLeaves', type: 'tuple[]', components: carryLeafComponents },
			{ name: 'nextPageNodeId', type: 'uint256' },
		],
	},
	{
		type: 'function',
		name: 'getProofConsumedCarriedDepositIndexesByOutcome',
		stateMutability: 'view',
		inputs: [
			{ name: 'outcome', type: 'uint8' },
			{ name: 'startIndex', type: 'uint256' },
			{ name: 'numberOfEntries', type: 'uint256' },
		],
		outputs: [{ name: 'parentDepositIndexes', type: 'uint256[]' }],
	},
	{ type: 'function', name: 'rootClaimSourceGame', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const
