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
		name: 'getProofConsumedCarriedDepositIndexesByOutcome',
		stateMutability: 'view',
		inputs: [
			{ name: 'outcome', type: 'uint8' },
			{ name: 'startIndex', type: 'uint256' },
			{ name: 'numberOfEntries', type: 'uint256' },
		],
		outputs: [{ name: 'parentDepositIndexes', type: 'uint256[]' }],
	},
] as const
