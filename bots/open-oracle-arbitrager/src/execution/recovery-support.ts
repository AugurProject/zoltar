import { bigintToSafeNumber, decodeEventLog, readContractAtBlock, rpcFailureWithContext, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { erc20Abi, openOracleAbi, openOracleArbitrageExecutorAbi, openOraclePriceCoordinatorAbi } from '#contracts/abi'
import type { Configuration } from '#config/configuration'
import { receiptGasExpendituresWithQuorum, recoveredTransactionIntentMismatch, transactionIntentWithQuorum } from '#execution/execution-orchestration'
import type { ReadClient, RecoveryConfiguration } from '#core/operator-types'
import { requiredBigint, requiredRpcAddress, requiredTuple } from '#core/rpc-validation'
import { batchRead, batchValue, type BatchReader } from '#core/batch-read'
import { type ActiveReport } from '#monitoring/oracle-log-state'
import { endpointLabel } from '#monitoring/connectivity'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { DurableTransactionIntent, PositionRecord } from '#state/position-store'
import { decimalWeth } from '#state/operator-state'
import { type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'

export function dateFromBlockTimestamp(timestamp: bigint) {
	const milliseconds = timestamp * 1_000n
	if (milliseconds < 0n || milliseconds > 8_640_000_000_000_000n) throw new Error('Canonical block timestamp is outside the supported date range')
	return new Date(bigintToSafeNumber(milliseconds, 'Canonical block timestamp'))
}

export async function confirmedGasExpenditures(readClients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>, label: string, receipts: Parameters<typeof receiptGasExpendituresWithQuorum>[3]) {
	const expenditures = await receiptGasExpendituresWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], label, receipts)
	return expenditures.map(expenditure => ({
		costEth: decimalWeth(expenditure.costAttoEth),
		minedAt: expenditure.minedAt,
		transactionHash: expenditure.transactionHash,
	}))
}

export function durableTransactionIntent(transaction: { input: Hex; to?: Address | null | undefined; value: bigint }): DurableTransactionIntent {
	if (transaction.to === undefined || transaction.to === null) throw new Error('Contract execution transaction is missing its destination')
	return {
		data: transaction.input,
		to: transaction.to,
		value: transaction.value.toString(),
	}
}

export async function recoveredTransactionIntentMismatchWithQuorum(readClients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>, label: string, transactionHash: Hex, account: Address, nonce: string | undefined, expected: DurableTransactionIntent | undefined) {
	const actual = await transactionIntentWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], label, transactionHash)
	return recoveredTransactionIntentMismatch(expected, actual, account, nonce)
}

export function hedgeExecutionFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], executor: Address) {
	for (const log of logs) {
		if (log.address.toLowerCase() !== executor.toLowerCase()) continue
		try {
			const decoded = decodeEventLog({ abi: openOracleArbitrageExecutorAbi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'HedgeAndDisputeExecuted') continue
			return {
				account: decoded.args.account,
				boughtToken2: decoded.args.boughtToken2,
				contribution1: decoded.args.contribution1,
				contribution2: decoded.args.contribution2,
				hedgeAmountToken2: decoded.args.hedgeAmountToken2,
				hedgeAmountAttoWeth: decoded.args.hedgeAmountAttoWeth,
				reportId: decoded.args.reportId,
			}
		} catch (error) {
			void error
		}
	}
	throw new Error('Confirmed executor transaction did not emit HedgeAndDisputeExecuted')
}

export function lifecycleExecutionFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], executor: Address) {
	for (const log of logs) {
		if (log.address.toLowerCase() !== executor.toLowerCase()) continue
		try {
			const decoded = decodeEventLog({ abi: openOracleArbitrageExecutorAbi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'LifecycleExecuted') continue
			return {
				account: decoded.args.account,
				amount1: decoded.args.amount1,
				amount2: decoded.args.amount2,
				reportId: decoded.args.reportId,
				settlerRewardAttoEth: decoded.args.settlerRewardAttoEth,
				token1: decoded.args.token1,
				token2: decoded.args.token2,
			}
		} catch (error) {
			void error
		}
	}
	throw new Error('Confirmed executor transaction did not emit LifecycleExecuted')
}

export function replacementCreditExecutionFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], executor: Address) {
	for (const log of logs) {
		if (log.address.toLowerCase() !== executor.toLowerCase()) continue
		try {
			const decoded = decodeEventLog({ abi: openOracleArbitrageExecutorAbi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'ReplacementCreditWithdrawn') continue
			return {
				account: decoded.args.account,
				amount: decoded.args.amount,
				reportId: decoded.args.reportId,
				token: decoded.args.token,
			}
		} catch (error) {
			void error
		}
	}
	throw new Error('Confirmed executor transaction did not emit ReplacementCreditWithdrawn')
}

export function immediateReplacementAmounts(position: Pick<PositionRecord, 'entryTransactionHash'>, report: Pick<ActiveReport, 'steps'> | undefined) {
	if (report === undefined) return undefined
	const entryIndex = report.steps.findIndex(step => step.transactionHash?.toLowerCase() === position.entryTransactionHash.toLowerCase())
	if (entryIndex < 0) return undefined
	const successor = report.steps[entryIndex + 1]
	if (successor?.event !== 'disputed' || successor.amount1 === undefined || successor.amount2 === undefined) return undefined
	return { amount1: BigInt(successor.amount1), amount2: BigInt(successor.amount2) }
}

async function canonicalBlockSnapshot<T>(client: ReadClient, endpoint: string, blockNumber: bigint, label: string, read: () => Promise<T>) {
	const readBlock = async (phase: 'after' | 'before') => {
		try {
			const block = await client.getBlock({ blockNumber })
			if (block.hash === null || block.hash === undefined) throw new Error(`${label} block ${blockNumber.toString()} is missing its canonical hash ${phase} the read`)
			return { ...block, hash: block.hash }
		} catch (error) {
			throw rpcFailureWithContext(error, endpoint, 'eth_getBlockByNumber')
		}
	}
	const blockBefore = await readBlock('before')
	const value = await read()
	const blockAfter = await readBlock('after')
	if (blockBefore.hash.toLowerCase() !== blockAfter.hash.toLowerCase()) throw new Error(`Canonical block ${blockNumber.toString()} changed during ${label}`)
	return { blockHash: blockAfter.hash, blockTimestamp: blockAfter.timestamp, value }
}

export async function pendingNonceWithQuorum(clients: readonly ReadClient[], config: Configuration, account: Address) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	return settledQuorumValue(
		'pending account nonce used for signing',
		clients.map(async (client, index) => ({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: await client.getTransactionCount({ address: account, blockTag: 'pending' }),
		})),
	)
}

export async function confirmedNonceWithQuorum(clients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>, account: Address, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	return settledQuorumValue(
		`confirmed account nonce at block ${blockNumber.toString()}`,
		clients.map(async (client, index) => ({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: await client.getTransactionCount({ address: account, blockNumber }),
		})),
	)
}

export async function currentBlockNumberWithQuorum(clients: readonly ReadClient[], config: Configuration, label: string) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	return settledQuorumValue(
		label,
		clients.map(async (client, index) => ({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: await client.getBlockNumber(),
		})),
	)
}

function decodeStoredReport(rawGame: unknown, rawHelper: unknown, id: bigint): OpenOracleStatePreimage {
	const game = requiredTuple(rawGame, 20, 'Stored OpenOracle game')
	const helper = requiredTuple(rawHelper, 3, 'Stored OpenOracle helper')
	return {
		game: {
			currentAmount1: requiredBigint(game[0], 'Stored OpenOracle currentAmount1'),
			currentAmount2: requiredBigint(game[1], 'Stored OpenOracle currentAmount2'),
			currentReporter: requiredRpcAddress(game[2], 'Stored OpenOracle currentReporter'),
			reportTimestamp: requiredBigint(game[3], 'Stored OpenOracle reportTimestamp'),
			settlementTimestamp: requiredBigint(game[4], 'Stored OpenOracle settlementTimestamp'),
			token1: requiredRpcAddress(game[5], 'Stored OpenOracle token1'),
			lastReportOppoTime: requiredBigint(game[6], 'Stored OpenOracle lastReportOppoTime'),
			settlementTime: requiredBigint(game[7], 'Stored OpenOracle settlementTime'),
			escalationHalt: requiredBigint(game[8], 'Stored OpenOracle escalationHalt'),
			protocolFeeRecipient: requiredRpcAddress(game[9], 'Stored OpenOracle protocolFeeRecipient'),
			settlerRewardAttoEth: requiredBigint(game[10], 'Stored OpenOracle settlerRewardAttoEth'),
			token2: requiredRpcAddress(game[11], 'Stored OpenOracle token2'),
			numReports: requiredBigint(game[12], 'Stored OpenOracle numReports'),
			disputeDelay: requiredBigint(game[13], 'Stored OpenOracle disputeDelay'),
			feePercentage: requiredBigint(game[14], 'Stored OpenOracle feePercentage'),
			multiplier: requiredBigint(game[15], 'Stored OpenOracle multiplier'),
			callbackContract: requiredRpcAddress(game[16], 'Stored OpenOracle callbackContract'),
			callbackGasLimit: requiredBigint(game[17], 'Stored OpenOracle callbackGasLimit'),
			protocolFee: requiredBigint(game[18], 'Stored OpenOracle protocolFee'),
			flags: requiredBigint(game[19], 'Stored OpenOracle flags'),
		},
		helper: {
			blockNumber: requiredBigint(helper[2], 'Stored OpenOracle helper blockNumber'),
			blockTimestamp: requiredBigint(helper[1], 'Stored OpenOracle helper blockTimestamp'),
			creator: requiredRpcAddress(helper[0], 'Stored OpenOracle helper creator'),
			reportId: id,
		},
	}
}

async function storedReport(client: ReadClient, openOracle: Address, id: bigint, blockNumber?: bigint | undefined): Promise<OpenOracleStatePreimage> {
	const [rawGame, rawHelper] = await Promise.all([
		blockNumber === undefined ? client.readContract({ address: openOracle, abi: openOracleAbi, functionName: 'storedGame', args: [id] }) : readContractAtBlock(client, { address: openOracle, abi: openOracleAbi, functionName: 'storedGame', args: [id] }, blockNumber),
		blockNumber === undefined ? client.readContract({ address: openOracle, abi: openOracleAbi, functionName: 'storedHelper', args: [id] }) : readContractAtBlock(client, { address: openOracle, abi: openOracleAbi, functionName: 'storedHelper', args: [id] }, blockNumber),
	])
	return decodeStoredReport(rawGame, rawHelper, id)
}

type CoordinatorReportConfiguration = Pick<Configuration, 'connectivity' | 'coordinatorAddresses' | 'openOracle' | 'quorumRpcUrls'> & { network: Pick<Configuration['network'], 'multicall3'> }

/** Reads every coordinator's pending report id in one batch, then every pending report's stored state in a second. */
export async function pendingCoordinatorReports(client: BatchReader, config: Pick<CoordinatorReportConfiguration, 'coordinatorAddresses' | 'network' | 'openOracle'>, blockNumber: bigint) {
	const pendingIds = await batchRead(
		client,
		config.network.multicall3,
		config.coordinatorAddresses.map(coordinator => ({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'pendingReportId' })),
		blockNumber,
	)
	const pending = config.coordinatorAddresses.flatMap((coordinator, index) => {
		const reportId = requiredBigint(batchValue(pendingIds[index], `Coordinator ${coordinator} pending report id`), `Coordinator ${coordinator} pending report id`)
		return reportId === 0n ? [] : [{ coordinator, reportId }]
	})
	const stored = await batchRead(
		client,
		config.network.multicall3,
		pending.flatMap(({ reportId }) => [
			{ address: config.openOracle, abi: openOracleAbi, functionName: 'storedGame', args: [reportId] },
			{ address: config.openOracle, abi: openOracleAbi, functionName: 'storedHelper', args: [reportId] },
		]),
		blockNumber,
	)
	return pending.map(({ coordinator, reportId }, index) => {
		const report = decodeStoredReport(batchValue(stored[index * 2], `Stored OpenOracle game ${reportId.toString()}`), batchValue(stored[index * 2 + 1], `Stored OpenOracle helper ${reportId.toString()}`), reportId)
		if (report.helper.creator.toLowerCase() !== coordinator.toLowerCase()) throw new Error(`Coordinator ${coordinator} pending report ${reportId.toString()} was created by ${report.helper.creator}`)
		return report
	})
}

export async function pendingCoordinatorReportsWithQuorum(clients: readonly ReadClient[], config: CoordinatorReportConfiguration, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	return settledQuorumValue(
		`pending coordinator reports at block ${blockNumber.toString()}`,
		clients.map(async (client, index) => {
			const endpoint = endpointLabel(endpoints[index] ?? '')
			const snapshot = await canonicalBlockSnapshot(client, endpoint, blockNumber, 'pending coordinator report snapshot', () => pendingCoordinatorReports(client, config, blockNumber))
			return { endpoint, value: { blockHash: snapshot.blockHash, reports: snapshot.value } }
		}),
	).then(result => result.reports)
}

async function disputeRecord(client: ReadClient, openOracle: Address, reportId: bigint, disputeIndex: bigint, blockNumber: bigint) {
	const rawRecord = await readContractAtBlock(client, { address: openOracle, abi: openOracleAbi, functionName: 'disputeHistory', args: [reportId, disputeIndex] }, blockNumber)
	const record = requiredTuple(rawRecord, 4, `OpenOracle report ${reportId.toString()} dispute ${disputeIndex.toString()}`)
	return {
		amount1: requiredBigint(record[0], 'OpenOracle dispute amount1'),
		amount2: requiredBigint(record[1], 'OpenOracle dispute amount2'),
		reportTimestamp: requiredBigint(record[3], 'OpenOracle dispute timestamp'),
	}
}

export async function replacementDisputeAmountsWithQuorum(clients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'openOracle' | 'quorumRpcUrls'>, reportId: bigint, disputeIndex: bigint, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	return settledQuorumValue(
		`replacement dispute ${disputeIndex.toString()} for report ${reportId.toString()} at block ${blockNumber.toString()}`,
		clients.map(async (client, index) => {
			const endpoint = endpointLabel(endpoints[index] ?? '')
			const snapshot = await canonicalBlockSnapshot(client, endpoint, blockNumber, 'replacement dispute snapshot', () => disputeRecord(client, config.openOracle, reportId, disputeIndex, blockNumber))
			return { endpoint, value: { blockHash: snapshot.blockHash, record: snapshot.value } }
		}),
	)
}

export async function storedReportWithQuorum(clients: readonly ReadClient[], config: Configuration, id: bigint, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	return settledQuorumValue(
		`stored report ${id.toString()} at block ${blockNumber.toString()}`,
		clients.map(async (client, index) => {
			const endpoint = endpointLabel(endpoints[index] ?? '')
			const snapshot = await canonicalBlockSnapshot(client, endpoint, blockNumber, `stored report ${id.toString()} snapshot`, () => storedReport(client, config.openOracle, id, blockNumber))
			return {
				endpoint,
				value: {
					blockHash: snapshot.blockHash,
					blockTimestamp: snapshot.blockTimestamp,
					report: snapshot.value,
				},
			}
		}),
	)
}

export async function lifecycleBalancesWithQuorum(clients: readonly ReadClient[], config: RecoveryConfiguration, account: Address, token: Address, blockNumber: bigint) {
	const executor = config.executor
	if (executor === undefined) throw new Error('Lifecycle balance reads require the authenticated executor')
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	return settledQuorumValue(
		`position lifecycle balances at block ${blockNumber.toString()}`,
		clients.map(async (client, index) => {
			const endpoint = endpointLabel(endpoints[index] ?? '')
			const snapshot = await canonicalBlockSnapshot(client, endpoint, blockNumber, 'position lifecycle balance snapshot', () =>
				Promise.all([
					readContractAtBlock(client, { address: config.openOracle, abi: openOracleAbi, functionName: 'tokenHolder', args: [account, config.network.weth] }, blockNumber),
					readContractAtBlock(client, { address: config.openOracle, abi: openOracleAbi, functionName: 'tokenHolder', args: [account, token] }, blockNumber),
					readContractAtBlock(client, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, config.network.weth] }, blockNumber),
					readContractAtBlock(client, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, token] }, blockNumber),
					readContractAtBlock(client, { address: token, abi: erc20Abi, functionName: 'decimals' }, blockNumber),
				]),
			)
			const [rawHolderWeth, rawHolderToken, rawAllowanceWeth, rawAllowanceToken, rawTokenDecimals] = snapshot.value
			return {
				endpoint,
				value: {
					blockHash: snapshot.blockHash,
					blockTimestamp: snapshot.blockTimestamp,
					internalAllowanceToken: requiredBigint(rawAllowanceToken, 'OpenOracle token internal allowance'),
					internalAllowanceAttoWeth: requiredBigint(rawAllowanceWeth, 'OpenOracle WETH internal allowance'),
					holderToken: requiredBigint(rawHolderToken, 'OpenOracle token holder balance'),
					holderAttoWeth: requiredBigint(rawHolderWeth, 'OpenOracle WETH holder balance'),
					tokenDecimals: requiredBigint(rawTokenDecimals, 'Position token decimals'),
				},
			}
		}),
	)
}
