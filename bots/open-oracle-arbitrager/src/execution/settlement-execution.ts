import type { Configuration } from '#config/configuration'
import { openOracleAbi } from '#contracts/abi'
import type { ReadClient, WriteClient } from '#core/operator-types'
import { rewardWithdrawalGasPlan, signedSettlementGasLimit } from '#core/settlement-strategy'
import { ATTEMPT_FINALITY_BLOCKS, attemptHasFinality, isExecutionPausedError, receiptGasExpendituresWithQuorum, transactionHashBySenderNonceWithQuorum, transactionReceiptsOrMissingWithQuorum, transactionReceiptsWithQuorum } from '#execution/execution-orchestration'
import { confirmedNonceWithQuorum, durableTransactionIntent, pendingNonceWithQuorum, recoveredTransactionIntentMismatchWithQuorum } from '#execution/recovery-support'
import { DEFAULT_TRANSACTION_VALIDITY_BLOCKS, prepareSignedTransaction, submissionRejectedEverywhere } from '#execution/transaction-submission'
import { submitContractTransaction, waitForTrackedTransaction, type TrackTransaction } from '#execution/transaction-tracker'
import { decimalWeth } from '#state/operator-state'
import { settlementAttemptIsUnresolved, type SettlementRecord } from '#state/settlement-store'
import { encodeFunctionData, zeroAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { endpointLabel } from '#monitoring/connectivity'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'

const ETH_SENTINEL: Address = zeroAddress

type SettlementExecutionConfiguration = Pick<Configuration, 'connectivity' | 'openOracle' | 'pollMilliseconds' | 'quorumRpcUrls' | 'settlement' | 'submission'> & { network: Pick<Configuration['network'], 'chain'> }

export type SettlementExecutionContext = {
	blockNumber: bigint
	baseFeePerGas: bigint
	client: ReadClient
	/** The fee ceiling every attempt is signed with, shared with the queue so projected costs match the signed exposure. */
	maxFeePerGas: bigint
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

type SignedAttempt = Pick<SettlementRecord, 'lastValidBlockNumber' | 'nonce' | 'submissionBlockNumber' | 'submissionMode' | 'transactionIntent'> & { hash: Hex }

async function signAndSubmit(context: SettlementExecutionContext, call: { data: Hex; gas: bigint; kind: 'settle' | 'withdraw-reward'; reportId: string | undefined; token: Address | undefined; tokenSymbol: string | undefined }, pending: (attempt: SignedAttempt) => SettlementRecord) {
	const account = context.wallet.account
	const signTransaction = account.signTransaction
	if (signTransaction === undefined) throw new Error('Settlement requires a local transaction signer')
	const nonce = await pendingNonceWithQuorum(context.readClients, context.config, account.address)
	// The signed horizon bounds the receipt wait; an attempt that never lands is left pending for journal reconciliation.
	// The fee cap keeps a delayed inclusion from paying more per gas than the queue judged the attempt at.
	const signed = await prepareSignedTransaction({
		baseFeePerGas: context.baseFeePerGas,
		blockNumber: context.blockNumber,
		chainId: context.config.network.chain.id,
		data: call.data,
		from: account.address,
		gasEstimate: call.gas,
		lastValidBlockNumber: context.blockNumber + DEFAULT_TRANSACTION_VALIDITY_BLOCKS,
		maxFeePerGasCap: context.config.settlement.maxGasPriceAttoEthPerGas,
		nonce,
		signTransaction,
		to: context.config.openOracle,
	})
	if (signed.transaction.maxFeePerGas !== context.maxFeePerGas) throw new Error(`Settlement signed a fee ceiling of ${signed.transaction.maxFeePerGas?.toString() ?? 'none'} but was evaluated at ${context.maxFeePerGas.toString()}`)
	if (signed.transaction.gas !== signedSettlementGasLimit(call.gas)) throw new Error(`Settlement signed a gas limit of ${signed.transaction.gas.toString()} but was evaluated at ${signedSettlementGasLimit(call.gas).toString()}`)
	const record = pending({ hash: signed.hash, lastValidBlockNumber: signed.maxBlockNumber.toString(), nonce: nonce.toString(), submissionBlockNumber: context.blockNumber.toString(), submissionMode: context.config.submission.mode, transactionIntent: durableTransactionIntent(signed.transaction) })
	let journaled = false
	let submission
	try {
		submission = await submitContractTransaction(context.client, context.wallet, context.config, signed, { estimatedNetProfitEth: undefined, kind: call.kind, reportId: call.reportId, token: call.token, tokenSymbol: call.tokenSymbol }, context.isPaused, context.track, {
			beforeSubmit: () => {},
			persistPending: async () => {
				await context.persist(record)
				journaled = true
			},
		})
	} catch (error) {
		// A journaled public attempt that no node holds (paused between the journal write and the send, or every RPC
		// refused it outright) has no mempool to land from; a public pending record never expires, so it is dropped here
		// instead of holding the report and the budget until an unrelated transaction consumes the nonce. A timeout or
		// HTTP failure may have followed an ingestion, so those stay pending for nonce recovery. Private attempts are
		// dropped by recovery once the relay horizon finalizes.
		if (journaled && context.config.submission.mode === 'public' && (isExecutionPausedError(error) || submissionRejectedEverywhere(error))) await context.persist({ ...record, status: 'dropped', updatedAt: new Date().toISOString() })
		throw error
	}
	const { receipt: observed } = await waitForTrackedTransaction(context.client, context.wallet, context.config, submission, context.track, () => {}, context.isPaused)
	if (observed.transactionHash.toLowerCase() !== signed.hash.toLowerCase()) {
		// A replacement at the same nonce only counts when it carries the signed call; either way the signed hash can no longer land.
		const mismatch = await recoveredTransactionIntentMismatchWithQuorum(context.readClients, context.config, 'settlement replacement', observed.transactionHash, account.address, nonce.toString(), durableTransactionIntent(signed.transaction))
		if (mismatch !== undefined) {
			await context.persist({ ...record, status: 'expired', updatedAt: new Date().toISOString() })
			throw new Error(`Settlement transaction ${signed.hash} was replaced by ${observed.transactionHash}: ${mismatch}`)
		}
	}
	const outcome = await receiptOutcome(context.readClients, context.config, observed.transactionHash)
	const final: SettlementRecord = { ...record, ...outcome, transactionHash: observed.transactionHash, updatedAt: new Date().toISOString() }
	// The mined outcome is journaled before the replaced hash is retired, so an interruption between the two writes leaves
	// a pending original that recovery retires against the already journaled replacement, never an unaccounted receipt.
	await context.persist(final)
	if (final.transactionHash.toLowerCase() !== record.transactionHash.toLowerCase()) await context.persist({ ...record, status: 'expired', updatedAt: new Date().toISOString() })
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
	return { actualGasCostEth: decimalWeth(expenditure.costAttoEth), minedAt: expenditure.minedAt, receiptBlock: { hash: receipt.blockHash, number: receipt.blockNumber.toString() }, status: receipt.status === 'success' ? ('confirmed' as const) : ('reverted' as const) }
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
	return signAndSubmit(context, { data: settleCalldata(plan.report), gas: plan.gas, kind: 'settle', reportId, token: plan.token, tokenSymbol: plan.tokenSymbol }, attempt => ({
		account: account.address,
		actualGasCostEth: undefined,
		coordinator: plan.coordinator,
		kind: 'settlement',
		lastValidBlockNumber: attempt.lastValidBlockNumber,
		minedAt: undefined,
		nonce: attempt.nonce,
		projectedGasCostEth: decimalWeth(plan.projectedGasCostAttoEth),
		receiptBlock: undefined,
		reportId,
		rewardEth: decimalWeth(plan.rewardAttoEth),
		status: 'pending',
		submissionBlockNumber: attempt.submissionBlockNumber,
		submissionMode: attempt.submissionMode,
		submittedAt: new Date().toISOString(),
		transactionHash: attempt.hash,
		transactionIntent: attempt.transactionIntent,
		updatedAt: new Date().toISOString(),
	}))
}

export async function executeRewardWithdrawal(context: SettlementExecutionContext, amountAttoEth: bigint) {
	if (amountAttoEth <= 0n) throw new Error('Settlement reward withdrawal amount must be positive')
	const account = context.wallet.account
	const gas = rewardWithdrawalGasPlan()
	const projectedGasCostAttoEth = signedSettlementGasLimit(gas) * context.maxFeePerGas
	return signAndSubmit(context, { data: encodeFunctionData({ abi: openOracleAbi, functionName: 'withdraw', args: [ETH_SENTINEL, amountAttoEth] }), gas, kind: 'withdraw-reward', reportId: undefined, token: undefined, tokenSymbol: undefined }, attempt => ({
		account: account.address,
		actualGasCostEth: undefined,
		coordinator: undefined,
		kind: 'reward-withdrawal',
		lastValidBlockNumber: attempt.lastValidBlockNumber,
		minedAt: undefined,
		nonce: attempt.nonce,
		projectedGasCostEth: decimalWeth(projectedGasCostAttoEth),
		receiptBlock: undefined,
		reportId: undefined,
		rewardEth: decimalWeth(amountAttoEth),
		status: 'pending',
		submissionBlockNumber: attempt.submissionBlockNumber,
		submissionMode: attempt.submissionMode,
		submittedAt: new Date().toISOString(),
		transactionHash: attempt.hash,
		transactionIntent: attempt.transactionIntent,
		updatedAt: new Date().toISOString(),
	}))
}

/**
 * Resolves records left `pending` by an interrupted process. A public transaction has no on-chain deadline, so an attempt
 * without a receipt stays pending until another transaction consumes its nonce at a reorg-safe depth; when the consuming
 * transaction carries the same intent (an operator rebroadcast) its receipt is adopted under the new hash, otherwise the
 * attempt is `expired` and can never be mined. A private relay stops including at the signed horizon, so a private
 * attempt whose horizon has finalized without a receipt is `dropped`: it releases the report and the budget but keeps
 * being rechecked here, while a dropped public attempt (never accepted anywhere) leaves the recheck set once its own
 * horizon has finalized. A mined outcome is rechecked until its receipt block has finality: a receipt that moved to
 * another block is re-read, and one a reorg orphaned returns the attempt to `pending`. Every outcome keeps its gas
 * accounted, so nothing is re-sent on top of a live attempt. Adopted outcomes precede the hash they retire so a partial
 * write never loses the receipt.
 */
export async function reconcilePendingSettlements(readClients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>, records: readonly SettlementRecord[], blockNumber: bigint) {
	const unresolved = records.filter(record => settlementAttemptIsUnresolved(record, blockNumber))
	if (unresolved.length === 0) return []
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const receipts = await transactionReceiptsOrMissingWithQuorum(
		readClients,
		endpoints,
		'settlement journal recovery',
		unresolved.map(record => record.transactionHash),
	)
	const resolved: SettlementRecord[] = []
	// Nonce consumption is judged this far behind the head so a reorg cannot retire an attempt that is still able to land.
	const finalityBlockNumber = blockNumber > ATTEMPT_FINALITY_BLOCKS ? blockNumber - ATTEMPT_FINALITY_BLOCKS : 0n
	const confirmedNonces = new Map<string, bigint>()
	for (const [index, record] of unresolved.entries()) {
		const receipt = receipts[index]
		const updatedAt = new Date().toISOString()
		if (receipt !== undefined) {
			if (record.receiptBlock !== undefined && record.receiptBlock.hash.toLowerCase() === receipt.blockHash.toLowerCase()) continue
			resolved.push({ ...record, ...(await receiptExpenditure(readClients, config, receipt)), updatedAt })
			continue
		}
		if (record.status === 'confirmed' || record.status === 'reverted') {
			// The receipt's block was orphaned: the attempt is live again until a receipt or a consumed nonce says otherwise.
			resolved.push({ ...record, actualGasCostEth: undefined, minedAt: undefined, receiptBlock: undefined, status: 'pending', updatedAt })
			continue
		}
		const accountKey = record.account.toLowerCase()
		let confirmedNonce = confirmedNonces.get(accountKey)
		if (confirmedNonce === undefined) {
			confirmedNonce = await confirmedNonceWithQuorum(readClients, config, record.account, finalityBlockNumber)
			confirmedNonces.set(accountKey, confirmedNonce)
		}
		const nonce = BigInt(record.nonce)
		if (nonce >= confirmedNonce) {
			if (record.status === 'pending' && record.submissionMode === 'private' && attemptHasFinality(blockNumber, BigInt(record.lastValidBlockNumber))) resolved.push({ ...record, status: 'dropped', updatedAt })
			continue
		}
		const submissionBlockNumber = BigInt(record.submissionBlockNumber)
		const consumingHash = await transactionHashBySenderNonceWithQuorum(readClients, endpoints, `settlement journal recovery ${record.transactionHash}`, {
			account: record.account,
			fromBlockNumber: submissionBlockNumber < finalityBlockNumber ? submissionBlockNumber : finalityBlockNumber,
			nonce,
			toBlockNumber: finalityBlockNumber,
		})
		const retired: SettlementRecord = { ...record, status: 'expired', updatedAt }
		// A consumer the journal already knows (the bot's own re-send at the same nonce) keeps its own record.
		if (consumingHash === undefined || records.some(existing => existing.transactionHash.toLowerCase() === consumingHash.toLowerCase())) {
			resolved.push(retired)
			continue
		}
		const mismatch = await recoveredTransactionIntentMismatchWithQuorum(readClients, config, `settlement journal recovery ${record.transactionHash}`, consumingHash, record.account, record.nonce, record.transactionIntent)
		if (mismatch === undefined) resolved.push({ ...record, ...(await receiptOutcome(readClients, config, consumingHash)), transactionHash: consumingHash, updatedAt })
		resolved.push(retired)
	}
	return resolved
}
