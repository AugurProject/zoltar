import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import { OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT, trustedOpenOracleReportPredicate } from '../../monitoring/protocol-index.ts'
import { amount, erc20WalletDebit, eventTopic, openOracleCreditDebit } from '../planning.ts'
import { requiredTimestampSafetySeconds, requiredWorkflowSafetyBlocks } from '../timing.ts'
import type { EcosystemSnapshot, OperationEvidence, OperationWalletAssetDebit, OracleGameSnapshot, PlanningOptions } from '../types.ts'

// Planning primitives shared by the OpenOracle operations: report windows, wallet debits, evidence, and report preimages.

export const MAX_UINT128 = (1n << 128n) - 1n
export const minAmount = (left: bigint, right: bigint) => (left < right ? left : right)

export function reportWindow(snapshot: EcosystemSnapshot, report: OracleGameSnapshot, options: PlanningOptions, prerequisiteCount = 0) {
	const timestampClock = (report.flags & 1) !== 0
	const current = amount(timestampClock ? snapshot.anchor.timestamp : snapshot.anchor.blockNumber)
	const opened = amount(report.reportTimestamp) + amount(report.disputeDelay)
	const closes = amount(report.reportTimestamp) + amount(report.settlementTime)
	return { closes, current, opened, safetyMargin: timestampClock ? requiredTimestampSafetySeconds(options, prerequisiteCount) : requiredWorkflowSafetyBlocks(prerequisiteCount), timestampClock }
}

export function tokenDebit(snapshot: EcosystemSnapshot, token: `0x${string}`, debitAmount: bigint): OperationWalletAssetDebit[] {
	if (debitAmount === 0n || token === zeroAddress) return []
	let category: Extract<OperationWalletAssetDebit, { kind: 'erc20' }>['category'] = 'other'
	if (snapshot.universes.some(universe => universe.repToken.toLowerCase() === token.toLowerCase())) category = 'rep'
	else if (token.toLowerCase() === snapshot.deployments.weth.toLowerCase()) category = 'weth'
	return [erc20WalletDebit(token, debitAmount, category)]
}

export function creditDebit(snapshot: EcosystemSnapshot, token: `0x${string}`, debitAmount: bigint): OperationWalletAssetDebit[] {
	if (debitAmount === 0n) return []
	let category: Extract<OperationWalletAssetDebit, { kind: 'open-oracle-credit' }>['category'] = 'other'
	if (snapshot.universes.some(universe => universe.repToken.toLowerCase() === token.toLowerCase())) category = 'rep'
	else if (token.toLowerCase() === snapshot.deployments.weth.toLowerCase()) category = 'weth'
	return [openOracleCreditDebit(snapshot.deployments.openOracle, token === zeroAddress ? 'ETH' : token, debitAmount, category)]
}

export function tokenHolderEvidence(snapshot: EcosystemSnapshot, token: `0x${string}`, expected: bigint): OperationEvidence {
	return {
		abi: 'function tokenHolder(address owner, address token) view returns (uint256)',
		args: [snapshot.wallet.address, token],
		contract: snapshot.deployments.openOracle,
		expected: expected.toString(),
		functionName: 'tokenHolder',
		kind: 'storage-postcondition',
		relation: 'at-least',
	}
}

export function exactTokenTransferEvidence(snapshot: EcosystemSnapshot, token: `0x${string}`, expected: bigint, recipient = snapshot.wallet.address): OperationEvidence {
	return {
		abi: 'event Transfer(address indexed from, address indexed to, uint256 value)',
		emitter: token,
		equals: expected.toString(),
		field: 'value',
		indexed: { from: snapshot.deployments.openOracle, to: recipient },
		kind: 'decoded-event-field',
		signature: 'Transfer(address,address,uint256)',
		topic0: eventTopic('Transfer(address,address,uint256)'),
	}
}

export function trustedReportPredicate(snapshot: EcosystemSnapshot) {
	return trustedOpenOracleReportPredicate({
		coordinatorReports: snapshot.pools.flatMap(pool => (pool.pendingReportId === '0' ? [] : [{ coordinator: pool.coordinator, pendingReportId: pool.pendingReportId, repToken: pool.repToken }])),
		maximumSettlementStepGasLimit: OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT,
		openOracle: snapshot.deployments.openOracle,
		trustedRepTokens: snapshot.universes.map(universe => universe.repToken),
		wallet: snapshot.wallet.address,
		weth: snapshot.deployments.weth,
	})
}

export function hasActiveSignerReport(snapshot: EcosystemSnapshot) {
	const trustedReport = trustedReportPredicate(snapshot)
	return snapshot.reports.some(report => report.settlementTimestamp === '0' && trustedReport(report) && report.helper.creator.toLowerCase() === snapshot.wallet.address.toLowerCase())
}
export function oracleGame(report: OracleGameSnapshot) {
	return {
		callbackContract: report.game.callbackContract,
		callbackGasLimit: report.game.callbackGasLimit,
		currentAmount1: BigInt(report.currentAmount1),
		currentAmount2: BigInt(report.currentAmount2),
		currentReporter: report.currentReporter,
		disputeDelay: BigInt(report.disputeDelay),
		escalationHalt: BigInt(report.escalationHalt),
		feePercentage: report.game.feePercentage,
		flags: report.flags,
		lastReportOppoTime: BigInt(report.game.lastReportOppoTime),
		multiplier: report.multiplier,
		numReports: report.game.numReports,
		protocolFee: report.game.protocolFee,
		protocolFeeRecipient: report.game.protocolFeeRecipient,
		reportTimestamp: BigInt(report.reportTimestamp),
		settlementTime: BigInt(report.settlementTime),
		settlementTimestamp: BigInt(report.settlementTimestamp),
		settlerReward: BigInt(report.game.settlerReward),
		token1: report.token1,
		token2: report.token2,
	}
}

export function oracleHelper(report: OracleGameSnapshot) {
	return {
		blockNumber: BigInt(report.helper.blockNumber),
		blockTimestamp: BigInt(report.helper.blockTimestamp),
		creator: report.helper.creator,
		reportId: BigInt(report.reportId),
	}
}

export const zeroTiming = { blockNumber: 0n, blockNumberBound: 0n, blockTimestamp: 0n, blockTimestampBound: 0n }
