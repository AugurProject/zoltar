import type { Configuration } from '#config/configuration'
import { openOracleAbi } from '#contracts/abi'
import type { ReadClient, WriteClient } from '#core/operator-types'
import { rewardWithdrawalGasPlan } from '#core/settlement-strategy'
import { receiptGasExpendituresWithQuorum, transactionReceiptsOrMissingWithQuorum, transactionReceiptsWithQuorum } from '#execution/execution-orchestration'
import { durableTransactionIntent, pendingNonceWithQuorum, recoveredTransactionIntentMismatchWithQuorum } from '#execution/recovery-support'
import { DEFAULT_TRANSACTION_VALIDITY_BLOCKS, prepareSignedTransaction } from '#execution/transaction-submission'
import { submitContractTransaction, waitForTrackedTransaction, type TrackTransaction } from '#execution/transaction-tracker'
import { decimalWeth } from '#state/operator-state'
import { settlementAttemptMayStillLand, type SettlementRecord } from '#state/settlement-store'
import { encodeFunctionData, zeroAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { endpointLabel } from '#monitoring/connectivity'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'

/** Blocks past the signed validity horizon after which a still-missing settlement receipt is treated as dropped. */
const EXPIRY_GRACE_BLOCKS = 12n
const ETH_SENTINEL: Address = zeroAddress

type SettlementExecutionConfiguration = Pick<Configuration, 'connectivity' | 'openOracle' | 'pollMilliseconds' | 'quorumRpcUrls' | 'submission'> & { network: Pick<Configuration['network'], 'chain'> }

export type SettlementExecutionContext = {
	blockNumber: bigint
	baseFeePerGas: bigint
	client: ReadClient
	/** The scan's projected gas price, shared with the queue so withdrawals are priced the same way. */
	gasPrice: bigint
	config: SettlementExecutionConfiguration
	isPaused: () => boolean
	persist: (record: SettlementRecord) => Promise<void>
	readClients: readonly ReadClient[]
	track: TrackTransaction
	wallet: WriteClient
}

export type SettlementPlan = {
	coordinator: Address
	gas: bigint
	projectedGasCostAttoEth: bigint
	report: OpenOracleStatePreimage
	rewardAttoEth: bigint
	token: Address
	tokenSymbol: string
}

/** Reads the ETH the wallet has accrued inside OpenOracle through the read quorum; one wei stays behind as the contract's balance sentinel. */
export async function unclaimedSettlementReward(readClients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'openOracle' | 'quorumRpcUrls'>, account: Address, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const balance = await settledQuorumValue(
		'unclaimed settlement reward',
		readClients.map(async (client, index) => ({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: await client.readContract({ address: config.openOracle, abi: openOracleAbi, functionName: 'tokenHolder', args: [account, ETH_SENTINEL], blockNumber }),
		})),
	)
	return balance > 1n ? balance - 1n : 0n
}

function settleCalldata(report: OpenOracleStatePreimage) {
	return encodeFunctionData({ abi: openOracleAbi, functionName: 'settle', args: [report.helper.reportId, getOpenOracleGameTuple(report.game), getOpenOracleHelperTuple(report.helper)] })
}

async function signAndSubmit(context: SettlementExecutionContext, call: { data: Hex; gas: bigint; kind: 'settle' | 'withdraw-reward'; reportId: string | undefined; token: Address | undefined; tokenSymbol: string | undefined }, pending: (hash: Hex, submissionBlockNumber: bigint) => SettlementRecord) {
	const account = context.wallet.account
	const signTransaction = account.signTransaction
	if (signTransaction === undefined) throw new Error('Settlement requires a local transaction signer')
	const nonce = await pendingNonceWithQuorum(context.readClients, context.config, account.address)
	// The signed horizon bounds the receipt wait; an attempt that never lands is left pending for journal reconciliation.
	const signed = await prepareSignedTransaction({
		baseFeePerGas: context.baseFeePerGas,
		blockNumber: context.blockNumber,
		chainId: context.config.network.chain.id,
		data: call.data,
		from: account.address,
		gasEstimate: call.gas,
		lastValidBlockNumber: context.blockNumber + DEFAULT_TRANSACTION_VALIDITY_BLOCKS,
		nonce,
		signTransaction,
		to: context.config.openOracle,
	})
	const record = pending(signed.hash, context.blockNumber)
	const submission = await submitContractTransaction(context.client, context.wallet, context.config, signed, { estimatedNetProfitEth: undefined, kind: call.kind, reportId: call.reportId, token: call.token, tokenSymbol: call.tokenSymbol }, context.isPaused, context.track, {
		beforeSubmit: () => {},
		persistPending: () => context.persist(record),
	})
	const { receipt: observed } = await waitForTrackedTransaction(context.client, context.wallet, context.config, submission, context.track, () => {}, context.isPaused)
	if (observed.transactionHash.toLowerCase() !== signed.hash.toLowerCase()) {
		// A replacement at the same nonce only counts when it carries the signed call; either way the signed hash can no longer land.
		const mismatch = await recoveredTransactionIntentMismatchWithQuorum(context.readClients, context.config, 'settlement replacement', observed.transactionHash, account.address, nonce.toString(), durableTransactionIntent(signed.transaction))
		await context.persist({ ...record, status: 'expired', updatedAt: new Date().toISOString() })
		if (mismatch !== undefined) throw new Error(`Settlement transaction ${signed.hash} was replaced by ${observed.transactionHash}: ${mismatch}`)
	}
	const outcome = await receiptOutcome(context.readClients, context.config, observed.transactionHash)
	const final: SettlementRecord = { ...record, ...outcome, transactionHash: observed.transactionHash, updatedAt: new Date().toISOString() }
	await context.persist(final)
	return final
}

/** Status, gas, and mined time come from quorum-confirmed receipts and canonical blocks, like the position ledger. */
async function receiptOutcome(readClients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>, transactionHash: Hex) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const [receipt] = await transactionReceiptsWithQuorum(readClients, endpoints, 'settlement journal', [transactionHash])
	if (receipt === undefined) throw new Error(`Settlement receipt ${transactionHash} was not returned by the read quorum`)
	return receiptExpenditure(readClients, config, receipt)
}

/** Gas and mined time come from the canonical receipt block through the same quorum read the position ledger uses. */
async function receiptExpenditure(readClients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>, receipt: Parameters<typeof receiptGasExpendituresWithQuorum>[3][number] & { status: 'reverted' | 'success' }) {
	const [expenditure] = await receiptGasExpendituresWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], 'settlement journal', [receipt])
	if (expenditure === undefined) throw new Error(`Settlement receipt ${receipt.transactionHash} produced no gas expenditure`)
	return { actualGasCostEth: decimalWeth(expenditure.costAttoEth), minedAt: expenditure.minedAt, status: receipt.status === 'success' ? ('confirmed' as const) : ('reverted' as const) }
}

/** Simulates at the head first so a report settled by someone else costs nothing instead of a reverted transaction. */
export async function executeSettlement(context: SettlementExecutionContext, plan: SettlementPlan) {
	const account = context.wallet.account
	await context.client.simulateContract({
		abi: openOracleAbi,
		account: account.address,
		address: context.config.openOracle,
		args: [plan.report.helper.reportId, getOpenOracleGameTuple(plan.report.game), getOpenOracleHelperTuple(plan.report.helper)],
		blockNumber: context.blockNumber,
		functionName: 'settle',
		gas: plan.gas,
	})
	const reportId = plan.report.helper.reportId.toString()
	return signAndSubmit(context, { data: settleCalldata(plan.report), gas: plan.gas, kind: 'settle', reportId, token: plan.token, tokenSymbol: plan.tokenSymbol }, (hash, submissionBlockNumber) => ({
		account: account.address,
		actualGasCostEth: undefined,
		coordinator: plan.coordinator,
		kind: 'settlement',
		minedAt: undefined,
		projectedGasCostEth: decimalWeth(plan.projectedGasCostAttoEth),
		reportId,
		rewardEth: decimalWeth(plan.rewardAttoEth),
		status: 'pending',
		submissionBlockNumber: submissionBlockNumber.toString(),
		submittedAt: new Date().toISOString(),
		transactionHash: hash,
		updatedAt: new Date().toISOString(),
	}))
}

export async function executeRewardWithdrawal(context: SettlementExecutionContext, amountAttoEth: bigint) {
	if (amountAttoEth <= 0n) throw new Error('Settlement reward withdrawal amount must be positive')
	const account = context.wallet.account
	const gas = rewardWithdrawalGasPlan()
	const projectedGasCostAttoEth = gas * context.gasPrice
	return signAndSubmit(context, { data: encodeFunctionData({ abi: openOracleAbi, functionName: 'withdraw', args: [ETH_SENTINEL, amountAttoEth] }), gas, kind: 'withdraw-reward', reportId: undefined, token: undefined, tokenSymbol: undefined }, (hash, submissionBlockNumber) => ({
		account: account.address,
		actualGasCostEth: undefined,
		coordinator: undefined,
		kind: 'reward-withdrawal',
		minedAt: undefined,
		projectedGasCostEth: decimalWeth(projectedGasCostAttoEth),
		reportId: undefined,
		rewardEth: decimalWeth(amountAttoEth),
		status: 'pending',
		submissionBlockNumber: submissionBlockNumber.toString(),
		submittedAt: new Date().toISOString(),
		transactionHash: hash,
		updatedAt: new Date().toISOString(),
	}))
}

/**
 * Resolves records left `pending` by an interrupted process from their receipts, expires them once their validity horizon
 * has passed, and keeps checking expired attempts for a bounded window in case the mempool included them late.
 */
export async function reconcilePendingSettlements(readClients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>, records: readonly SettlementRecord[], blockNumber: bigint) {
	const unresolved = records.filter(record => settlementAttemptMayStillLand(record, blockNumber))
	if (unresolved.length === 0) return []
	const receipts = await transactionReceiptsOrMissingWithQuorum(
		readClients,
		[config.connectivity.readRpcUrl, ...config.quorumRpcUrls],
		'settlement journal recovery',
		unresolved.map(record => record.transactionHash),
	)
	const resolved: SettlementRecord[] = []
	for (const [index, record] of unresolved.entries()) {
		const receipt = receipts[index]
		const updatedAt = new Date().toISOString()
		if (receipt !== undefined) {
			resolved.push({ ...record, ...(await receiptExpenditure(readClients, config, receipt)), updatedAt })
			continue
		}
		if (record.status === 'pending' && blockNumber > BigInt(record.submissionBlockNumber) + DEFAULT_TRANSACTION_VALIDITY_BLOCKS + EXPIRY_GRACE_BLOCKS) resolved.push({ ...record, status: 'expired', updatedAt })
	}
	return resolved
}
