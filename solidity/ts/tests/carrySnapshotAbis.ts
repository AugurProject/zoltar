import type { Abi } from '@zoltar/core-shared/evm/ethereum'

// Hand-written fragments for the carry-snapshot initializers on test harnesses and games.
// The generated artifact types nested fixed arrays (`bytes32[64][3]`) too narrowly for the
// runtime peak arrays the tests build, so these entry points are called through a plain `Abi`.

export const initializeForkCarrySnapshotAbi: Abi = [
	{
		inputs: [
			{ name: 'snapshotPeaksInput', type: 'bytes32[64][3]' },
			{ name: 'snapshotLeafCountsInput', type: 'uint256[3]' },
			{ name: 'snapshotCarryTotals', type: 'uint256[3]' },
			{ name: 'snapshotNullifierRoots', type: 'bytes32[3]' },
		],
		name: 'initializeForkCarrySnapshot',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
]

export const initializeForkCarrySnapshotWithResolutionBalancesAbi: Abi = [
	{
		inputs: [
			{ name: 'snapshotPeaksInput', type: 'bytes32[64][3]' },
			{ name: 'snapshotLeafCountsInput', type: 'uint256[3]' },
			{ name: 'snapshotCarryTotals', type: 'uint256[3]' },
			{ name: 'snapshotResolutionBalances', type: 'uint256[3]' },
			{ name: 'snapshotNullifierRoots', type: 'bytes32[3]' },
		],
		name: 'initializeForkCarrySnapshotWithResolutionBalances',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
]

export const initializeForkCarrySnapshotFromSourceAbi: Abi = [
	{
		inputs: [
			{ name: 'sourceGame', type: 'address' },
			{ name: 'snapshotId', type: 'bytes32' },
			{ name: 'snapshotPeaksInput', type: 'bytes32[64][3]' },
			{ name: 'snapshotLeafCountsInput', type: 'uint256[3]' },
			{ name: 'snapshotCarryTotals', type: 'uint256[3]' },
			{ name: 'snapshotNullifierRoots', type: 'bytes32[3]' },
		],
		name: 'initializeForkCarrySnapshotFromSource',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
]

// Game initialization accepts one bounded outcome from the pool's canonical snapshot.
export const initializeGameForkCarrySnapshotAbi: Abi = [
	{
		inputs: [
			{ name: 'sourceGame', type: 'address' },
			{ name: 'snapshotId', type: 'bytes32' },
			{ name: 'peaks', type: 'bytes32[64]' },
			{ name: 'leafCount', type: 'uint256' },
			{ name: 'carryTotalAttoRep', type: 'uint256' },
			{ name: 'resolutionBalanceAttoRep', type: 'uint256' },
			{ name: 'nullifierRoot', type: 'bytes32' },
		],
		name: 'initializeForkCarryOutcome',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
]
