import type { PendingTransactionIntent } from '#state/operator-state'
import { openOraclePriceCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeEventTopics } from '@zoltar/core-shared/evm/ethereum'
import { encodeFunctionData, keccak256, privateKeyToAccount, encodeAbiParameters, getAddress, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'

export const coordinator = getAddress('0x0000000000000000000000000000000000000010')

export function stagedOperationReceipt(success: boolean, operation = 0n, operationId = 1n): TransactionReceipt {
	const topics = encodeEventTopics({
		abi: openOraclePriceCoordinatorAbi,
		args: { errorMessage: success ? '' : 'liquidation too close to threshold', operation, operationId, success },
		eventName: 'ExecutedStagedOperation',
	})
	if (topics.some(topic => topic === null)) throw new Error('Test event topics must not contain wildcards')
	return {
		blockHash: `0x${'11'.repeat(32)}`,
		blockNumber: 1n,
		cumulativeGasUsed: 1n,
		from: getAddress('0x0000000000000000000000000000000000000020'),
		gasUsed: 1n,
		logs: [
			{
				address: coordinator,
				blockHash: `0x${'11'.repeat(32)}`,
				blockNumber: 1n,
				data: encodeAbiParameters(
					[
						{ name: 'operation', type: 'uint8' },
						{ name: 'success', type: 'bool' },
						{ name: 'errorMessage', type: 'string' },
					],
					[operation, success, success ? '' : 'liquidation too close to threshold'],
				),
				topics: topics.filter(topic => topic !== null),
			},
		],
		status: 'success',
		to: coordinator,
		transactionHash: `0x${'22'.repeat(32)}`,
		transactionIndex: 0n,
	}
}

export function queuedLiquidationReceipt(isPendingSlot: boolean, operator = getAddress('0x0000000000000000000000000000000000000020'), operation = 0n): TransactionReceipt {
	const target = operation === 1n ? operator : getAddress('0x0000000000000000000000000000000000000030')
	const queuedTopics = encodeEventTopics({
		abi: openOraclePriceCoordinatorAbi,
		args: { operationId: 1n, operator, targetVault: target },
		eventName: 'StagedOperationQueued',
	})
	const routeTopics = encodeEventTopics({ abi: openOraclePriceCoordinatorAbi, args: { operationId: 1n, operator, receiverVault: operator }, eventName: 'LiquidationRouteStaged' })
	if (queuedTopics.some(topic => topic === null) || routeTopics.some(topic => topic === null)) throw new Error('Test event topics must not contain wildcards')
	return {
		...stagedOperationReceipt(true),
		from: operator,
		logs: [
			{
				address: coordinator,
				blockHash: `0x${'11'.repeat(32)}`,
				blockNumber: 1n,
				data: encodeAbiParameters(
					[
						{ name: 'operation', type: 'uint8' },
						{ name: 'operationValue', type: 'uint256' },
						{ name: 'queuedAt', type: 'uint256' },
						{ name: 'validForSeconds', type: 'uint256' },
						{ name: 'snapshotTargetBackingUnits', type: 'uint256' },
						{ name: 'snapshotTargetCapacityOwnershipAttoRep', type: 'uint256' },
						{ name: 'snapshotTargetOpenInterestAttoEth', type: 'uint256' },
						{ name: 'snapshotTargetDisputeStakedAttoRep', type: 'uint256' },
						{ name: 'snapshotTotalPoolHeldAttoRep', type: 'uint256' },
						{ name: 'snapshotTotalRepBackingUnits', type: 'uint256' },
						{ name: 'isPendingSlot', type: 'bool' },
					],
					[operation, 10n, 1n, 60n, 10n, 10n, 10n, 0n, 10n, 10n, isPendingSlot],
				),
				topics: queuedTopics.filter(topic => topic !== null),
			},
			{
				address: coordinator,
				blockHash: `0x${'11'.repeat(32)}`,
				blockNumber: 1n,
				data: encodeAbiParameters(
					[
						{ name: 'targetVault', type: 'address' },
						{ name: 'approvalId', type: 'bytes32' },
						{ name: 'requestedDebtAttoEth', type: 'uint256' },
						{ name: 'reservedDebtAttoEth', type: 'uint256' },
					],
					[target, `0x${'00'.repeat(32)}`, 10n, 0n],
				),
				topics: routeTopics.filter(topic => topic !== null),
			},
		],
	}
}

export async function receiptIntent(operation: 0 | 1 = 0, pending = false) {
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	if (account.signTransaction === undefined) throw new Error('Test signer unavailable')
	const receipt = queuedLiquidationReceipt(pending, account.address, BigInt(operation))
	if (operation === 1) receipt.logs = receipt.logs.slice(0, 1)
	const target = operation === 1 ? account.address : '0x0000000000000000000000000000000000000030'
	const data =
		operation === 0
			? encodeFunctionData({ abi: openOraclePriceCoordinatorAbi, functionName: 'requestPriceIfNeededAndStageLiquidation', args: [target, account.address, 10n, `0x${'00'.repeat(32)}`, 60n, 0n, 0n, 0n] })
			: encodeFunctionData({ abi: openOraclePriceCoordinatorAbi, functionName: 'requestPriceIfNeededAndStageOperation', args: [1, target, 10n, 60n, 0n, 0n, 0n] })
	const serializedTransaction = await account.signTransaction({ chainId: 1, data, gas: 1_000_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 0n, to: coordinator, value: 0n })
	const intent: PendingTransactionIntent = {
		hash: keccak256(serializedTransaction),
		kind: operation === 0 ? 'liquidation' : 'withdrawal',
		label: 'Test operation',
		maxBlockNumber: 120n,
		mode: 'public',
		nonce: 0n,
		receiptExpectation: { type: 'staged-success', coordinator, operation },
		requiresMarketEvidence: true,
		sender: account.address,
		serializedTransaction,
		submissionBlock: 1n,
	}
	receipt.transactionHash = intent.hash
	return { intent, receipt }
}
