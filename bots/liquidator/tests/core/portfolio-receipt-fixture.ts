import type { PendingTransactionIntent } from '#state/operator-state'
import { securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeFunctionData, keccak256, privateKeyToAccount, getAddress, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'

export async function portfolioReceiptIntent(action: 'claimEarnings' | 'takeOverWithBounds' = 'claimEarnings') {
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	if (account.signTransaction === undefined) throw new Error('Test signer unavailable')
	const to = getAddress('0x0000000000000000000000000000000000000010')
	const data =
		action === 'claimEarnings'
			? encodeFunctionData({ abi: securityPoolCapitalLedgerAbi, functionName: action, args: [account.address] })
			: encodeFunctionData({ abi: securityPoolCapitalLedgerAbi, functionName: action, args: [1n, 10n, 0n, 5n, { maximumOwnerPrincipal: 100n, maximumOwnerCommitment: 25n, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: 2n, expectedSourceBatch: 0n }] })
	const serializedTransaction = await account.signTransaction({ chainId: 1, data, gas: 1_000_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 0n, to, value: 0n })
	const intent: PendingTransactionIntent = {
		hash: keccak256(serializedTransaction),
		kind: action === 'claimEarnings' ? 'fees' : 'liquidation',
		label: action === 'claimEarnings' ? 'Collect portfolio earnings' : 'Take over portfolio position 1',
		maxBlockNumber: 120n,
		mode: 'public',
		nonce: 0n,
		receiptExpectation: { type: 'transaction' },
		requiresMarketEvidence: true,
		sender: account.address,
		serializedTransaction,
		submissionBlock: 1n,
	}
	const receipt: TransactionReceipt = {
		blockHash: `0x${'11'.repeat(32)}`,
		blockNumber: 1n,
		cumulativeGasUsed: 1n,
		from: account.address,
		gasUsed: 1n,
		logs: [],
		status: 'success',
		to,
		transactionHash: intent.hash,
		transactionIndex: 0n,
	}
	return { intent, receipt }
}
