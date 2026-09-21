import { expect, test } from 'bun:test'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { createPublicClient, getAddress, privateKeyToAccount, type Hex, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { waitForTrackedTransaction, type TrackedSubmission } from '#execution/transaction-tracker'
import type { TransactionActivity } from '#state/operator-state'

const hash = `0x${'12'.repeat(32)}` as const
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const executor = getAddress('0x0000000000000000000000000000000000000002')

function receipt(): TransactionReceipt {
	return {
		blockHash: `0x${'ab'.repeat(32)}`,
		blockNumber: 100n,
		cumulativeGasUsed: 21_000n,
		effectiveGasPrice: 2n,
		from: account.address,
		gasUsed: 21_000n,
		logs: [],
		status: 'success',
		to: executor,
		transactionHash: hash,
		transactionIndex: 0n,
	}
}

function submission(profitBeforeGasAttoEth: bigint | undefined = undefined): TrackedSubmission {
	return {
		acceptedTargets: ['https://rpc.example'],
		estimatedNetProfitEth: undefined,
		failedTargets: [],
		hash,
		kind: 'dispute',
		lastValidBlockNumber: undefined,
		maxBlockNumber: 110n,
		mode: 'public',
		profitBeforeGasAttoEth,
		reportId: '7',
		serializedTransaction: `0x${'34'.repeat(64)}` as Hex,
		submittedAt: '2026-08-12T00:00:00.000Z',
		token: undefined,
		tokenSymbol: undefined,
		transaction: { from: account.address, gas: 21_000n, hash, input: '0x', nonce: 1n, to: executor, value: 0n },
	}
}

test('bounds each receipt wait so shutdown is observed within the grace period', async () => {
	const timeouts: (number | undefined)[] = []
	const activities: TransactionActivity['status'][] = []
	const client = createPublicClient({ chain: mainnet, transport: custom({ request: () => Promise.reject(new Error('confirmation retries must not read the chain')) }) })
	const wallet = {
		account,
		waitForTransactionReceipt: async (parameters: { timeout?: number | undefined }) => {
			timeouts.push(parameters.timeout)
			return receipt()
		},
	}
	const config = { connectivity: { publicRpcUrls: ['https://rpc.example'], readRpcUrl: 'https://rpc.example' }, submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] } } as const

	const short = await waitForTrackedTransaction(client, wallet, { ...config, pollMilliseconds: 1_000 }, submission(), activity => activities.push(activity.status))
	const long = await waitForTrackedTransaction(client, wallet, { ...config, pollMilliseconds: 3_600_000 }, submission(), activity => activities.push(activity.status))

	expect(timeouts).toEqual([1_000, 5_000])
	expect(short.receipt.status).toBe('success')
	expect(long.tracked.hash).toBe(hash)
	expect(activities).toEqual(['confirmed', 'confirmed'])
})

test('nets a known pre-gas profit against the mined gas, and only the gas when the transaction reverted', async () => {
	const activities: TransactionActivity[] = []
	const client = createPublicClient({ chain: mainnet, transport: custom({ request: () => Promise.reject(new Error('confirmation retries must not read the chain')) }) })
	const config = { connectivity: { publicRpcUrls: ['https://rpc.example'], readRpcUrl: 'https://rpc.example' }, pollMilliseconds: 1_000, submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] } } as const
	const walletFor = (status: TransactionReceipt['status']) => ({ account, waitForTransactionReceipt: async () => ({ ...receipt(), status }) })
	const track = (activity: TransactionActivity) => activities.push(activity)

	await waitForTrackedTransaction(client, walletFor('success'), config, submission(10n ** 14n), track)
	await waitForTrackedTransaction(client, walletFor('reverted'), config, submission(10n ** 14n), track)
	await waitForTrackedTransaction(client, walletFor('success'), config, submission(), track)
	// A same-nonce replacement is not credited until the caller authenticates its intent.
	const replacementHash = `0x${'56'.repeat(32)}` as const
	await waitForTrackedTransaction(client, { account, waitForTransactionReceipt: async () => ({ ...receipt(), transactionHash: replacementHash }) }, config, submission(10n ** 14n), track)

	// The receipt burns 21,000 gas at 2 attoETH each.
	expect(activities.map(activity => [activity.status, activity.hash, activity.actualGasCostEth, activity.trackedNetProfitEth])).toEqual([
		['confirmed', hash, '0.000000000000042', '0.000099999999958'],
		['reverted', hash, '0.000000000000042', '-0.000000000000042'],
		['confirmed', hash, '0.000000000000042', undefined],
		['confirmed', replacementHash, '0.000000000000042', undefined],
	])
})
