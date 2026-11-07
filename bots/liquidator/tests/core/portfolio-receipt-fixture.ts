import type { PendingTransactionIntent } from '#state/operator-state'
import { securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeFunctionData, keccak256, privateKeyToAccount, getAddress, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'

export async function portfolioReceiptIntent() {
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	if (account.signTransaction === undefined) throw new Error('Test signer unavailable')
	const to = getAddress('0x0000000000000000000000000000000000000010')
	const data = encodeFunctionData({ abi: securityPoolCapitalLedgerAbi, functionName: 'claimEarnings' })
	const serializedTransaction = await account.signTransaction({ chainId: 1, data, gas: 1_000_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 0n, to, value: 0n })
	const intent: PendingTransactionIntent = {
		hash: keccak256(serializedTransaction),
		kind: 'fees',
		label: 'Collect portfolio earnings',
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
