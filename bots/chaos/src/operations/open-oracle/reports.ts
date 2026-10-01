import { openOracleAbi } from '@zoltar/bot-shared/contracts/abi'
import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import { tokenSpend } from '../input-funding.ts'
import { amount, eligible, encodeStep, eventEvidence, ONE_TOKEN, optionAmount, planBase, tokenInventory } from '../planning.ts'
import type { OperationDefinition } from '../types.ts'
import { approveToken, maximumCleanupCount, openOracleCleanupPlan, preparedApprovalState, remainingApprovalSteps, requiredMetadataAddress, requiredMetadataAmount } from './approvals.ts'
import { hasActiveSignerReport, MAX_UINT128, minAmount, tokenDebit, zeroTiming } from './planning.ts'

export const report: OperationDefinition = {
	buildPlan(snapshot, options) {
		if (hasActiveSignerReport(snapshot)) return undefined
		const rep = snapshot.universes[0]?.repToken
		if (rep === undefined) return undefined
		const amount1 = minAmount(tokenSpend(snapshot, snapshot.deployments.weth, options, 'report-weth', 'amount1'), MAX_UINT128 / 100n)
		const amount2 = minAmount(tokenSpend(snapshot, rep, options, 'report-rep', 'amount2'), MAX_UINT128)
		if (amount1 === 0n || amount2 === 0n) return undefined
		const params = {
			callbackContract: zeroAddress,
			callbackGasLimit: 0,
			currentAmount1: amount1,
			currentAmount2: amount2,
			currentReporter: snapshot.wallet.address,
			disputeDelay: 60,
			escalationHalt: amount1 * 100n,
			feePercentage: 0,
			flags: 7,
			lastReportOppoTime: 0,
			multiplier: 140,
			numReports: 0,
			protocolFee: 0,
			protocolFeeRecipient: zeroAddress,
			reportTimestamp: 0,
			settlementTime: 900,
			settlementTimestamp: 0,
			settlerReward: 0,
			token1: snapshot.deployments.weth,
			token2: rep,
		}
		const steps = approveToken(snapshot, snapshot.deployments.weth, amount1)
		steps.push(...approveToken(snapshot, rep, amount2))
		steps.push(
			encodeStep({
				abi: openOracleAbi,
				args: [params, false, false, zeroTiming],
				evidence: [eventEvidence(snapshot.deployments.openOracle, 'ReportSubmitted(uint256,bytes)')],
				functionName: 'report',
				id: 'report',
				label: 'Submit OpenOracle report',
				to: snapshot.deployments.openOracle,
				walletAssetDebits: [...tokenDebit(snapshot, snapshot.deployments.weth, amount1), ...tokenDebit(snapshot, rep, amount2)],
			}),
		)
		return planBase({
			definitionId: report.id,
			ecosystem: 'open-oracle',
			label: report.label,
			maximumCleanupTransactionCount: steps.length > 1 ? steps.length - 1 : undefined,
			metadata: { amount1: amount1.toString(), amount2: amount2.toString(), openOracle: snapshot.deployments.openOracle, token1: snapshot.deployments.weth, token2: rep },
			postconditions: ['ReportSubmitted identifies a new indexed report that becomes a settlement obligation'],
			risk: 'high',
			snapshot,
			steps,
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const amount1 = requiredMetadataAmount(context.previousPlan.metadata, 'amount1')
		const amount2 = requiredMetadataAmount(context.previousPlan.metadata, 'amount2')
		const openOracle = requiredMetadataAddress(context.previousPlan.metadata, 'openOracle')
		const token1 = requiredMetadataAddress(context.previousPlan.metadata, 'token1')
		const token2 = requiredMetadataAddress(context.previousPlan.metadata, 'token2')
		const requirements = [
			{ id: `approve-${token1}`, required: amount1, spender: openOracle, token: token1 },
			{ id: `approve-${token2}`, required: amount2, spender: openOracle, token: token2 },
		]
		const cleanup = () => openOracleCleanupPlan(snapshot, context, requirements, 'Clean up OpenOracle report approvals', 'high')
		if (context.continuationDisposition === 'cleanup-only') return cleanup()
		const rootRep = snapshot.universes[0]?.repToken
		const token1Inventory = tokenInventory(snapshot, token1)
		const token2Inventory = tokenInventory(snapshot, token2)
		const safe =
			options.allowHighRisk === true &&
			!hasActiveSignerReport(snapshot) &&
			snapshot.deployments.openOracle.toLowerCase() === openOracle.toLowerCase() &&
			snapshot.deployments.weth.toLowerCase() === token1.toLowerCase() &&
			rootRep?.toLowerCase() === token2.toLowerCase() &&
			amount1 > 0n &&
			amount1 <= MAX_UINT128 / 100n &&
			amount2 > 0n &&
			amount2 <= MAX_UINT128 &&
			amount1 <= optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n) &&
			amount2 <= optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) &&
			token1Inventory !== undefined &&
			amount(token1Inventory.balance) >= amount1 + 1n &&
			token2Inventory !== undefined &&
			amount(token2Inventory.balance) >= amount2 + optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN) &&
			preparedApprovalState(snapshot, context, requirements)
		if (!safe) return cleanup()
		const params = {
			callbackContract: zeroAddress,
			callbackGasLimit: 0,
			currentAmount1: amount1,
			currentAmount2: amount2,
			currentReporter: snapshot.wallet.address,
			disputeDelay: 60,
			escalationHalt: amount1 * 100n,
			feePercentage: 0,
			flags: 7,
			lastReportOppoTime: 0,
			multiplier: 140,
			numReports: 0,
			protocolFee: 0,
			protocolFeeRecipient: zeroAddress,
			reportTimestamp: 0,
			settlementTime: 900,
			settlementTimestamp: 0,
			settlerReward: 0,
			token1,
			token2,
		}
		const steps = remainingApprovalSteps(snapshot, context, requirements)
		steps.push(
			encodeStep({
				abi: openOracleAbi,
				args: [params, false, false, zeroTiming],
				evidence: [eventEvidence(openOracle, 'ReportSubmitted(uint256,bytes)')],
				functionName: 'report',
				id: 'report',
				label: 'Submit OpenOracle report',
				to: openOracle,
				walletAssetDebits: [...tokenDebit(snapshot, token1, amount1), ...tokenDebit(snapshot, token2, amount2)],
			}),
		)
		return planBase({
			definitionId: report.id,
			ecosystem: 'open-oracle',
			label: report.label,
			maximumCleanupTransactionCount: maximumCleanupCount(context.previousPlan, snapshot, requirements),
			metadata: context.previousPlan.metadata,
			postconditions: ['ReportSubmitted identifies a new indexed report that becomes a settlement obligation'],
			risk: 'high',
			snapshot,
			steps,
		})
	},
	classification: 'selectable',
	contract: 'OpenOracle',
	description: 'Creates a bounded, stored, timestamp-clock WETH/REP report with recoverable preimage data.',
	discoveryInputs: ['WETH and REP balances/allowances', 'durable report index'],
	ecosystem: 'open-oracle',
	evaluate(snapshot, options) {
		const rep = snapshot.universes[0]?.repToken
		return eligible(
			options.allowHighRisk === true ? undefined : 'High-risk operations are disabled',
			hasActiveSignerReport(snapshot) ? 'A signer-created OpenOracle report is still unresolved' : undefined,
			rep === undefined ? 'Root REP is unavailable' : undefined,
			minAmount(tokenSpend(snapshot, snapshot.deployments.weth, options, 'report-weth', 'amount1'), MAX_UINT128 / 100n) === 0n ? 'No WETH is spendable within policy and uint128 report bounds' : undefined,
			rep === undefined || minAmount(tokenSpend(snapshot, rep, options, 'report-rep', 'amount2'), MAX_UINT128) === 0n ? 'No REP is spendable within policy and uint128 report bounds' : undefined,
		)
	},
	id: 'open-oracle.report',
	label: 'Submit OpenOracle report',
	method: 'report',
	risk: 'high',
}
