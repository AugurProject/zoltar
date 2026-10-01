import { openOracleAbi } from '@zoltar/bot-shared/contracts/abi'
import { zeroAddress, type AbiValue } from '@zoltar/bot-shared/ethereum'
import { OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT } from '../../monitoring/protocol-index.ts'
import { choose, eligible, encodeStep, eventEvidence, mixSeed, planBase } from '../planning.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationStep, OracleGameSnapshot, PlanningOptions } from '../types.ts'
import { approveToken, cleanupApprovalRequirements, openOracleCleanupPlan, preparedApprovalState, requiredMetadataAddress, requiredMetadataAmount, requiredMetadataBoolean, requiredMetadataString } from './approvals.ts'
import { disputableReport, disputeQuote, disputeWindow } from './dispute-quote.ts'
import { creditDebit, oracleGame, oracleHelper, reportWindow, tokenDebit, trustedReportPredicate, zeroTiming } from './planning.ts'

export function reportOperation(mode: 'dispute' | 'settle'): OperationDefinition {
	const id = `open-oracle.${mode}`
	const candidates = (snapshot: EcosystemSnapshot, options: PlanningOptions) => {
		const trustedReport = trustedReportPredicate(snapshot)
		return snapshot.reports.filter(candidate => {
			if (!trustedReport(candidate)) return false
			if (candidate.settlementTimestamp !== '0') return false
			if (mode === 'dispute') return disputableReport(snapshot, candidate, options)
			const window = reportWindow(snapshot, candidate, options)
			return window.current >= window.closes
		})
	}
	const build = (snapshot: EcosystemSnapshot, options: PlanningOptions, selected: OracleGameSnapshot) => {
		let args: readonly AbiValue[]
		let steps: OperationStep[] = []
		if (mode === 'settle') args = [BigInt(selected.reportId), oracleGame(selected), oracleHelper(selected)]
		else {
			const quote = disputeQuote(snapshot, selected, options)
			if (quote === undefined || !quote.affordable) return undefined
			steps = approveToken(snapshot, selected.token1, quote.external1)
			steps.push(...approveToken(snapshot, selected.token2, quote.external2))
			args = [BigInt(selected.reportId), quote.new1, quote.new2, snapshot.wallet.address, true, true, oracleGame(selected), oracleHelper(selected), zeroTiming]
		}
		const quote = mode === 'dispute' ? disputeQuote(snapshot, selected, options) : undefined
		if (mode === 'dispute' && quote === undefined) return undefined
		const nativeValue = quote === undefined ? 0n : (selected.token1 === zeroAddress ? quote.maximumWalletDebit1 : 0n) + (selected.token2 === zeroAddress ? quote.maximumWalletDebit2 : 0n)
		steps.push(
			encodeStep({
				abi: openOracleAbi,
				args,
				evidence: [eventEvidence(selected.openOracle, mode === 'settle' ? 'ReportSettled(uint256)' : 'ReportDisputed(uint256,bytes)')],
				functionName: mode,
				id: `${mode}-${selected.reportId}`,
				label: `${mode} report ${selected.reportId}`,
				to: selected.openOracle,
				gasLimit: mode === 'settle' ? OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT : undefined,
				value: nativeValue > 0n ? nativeValue : undefined,
				walletAssetDebits: quote === undefined ? [] : [...creditDebit(snapshot, selected.token1, quote.internal1), ...creditDebit(snapshot, selected.token2, quote.internal2), ...tokenDebit(snapshot, selected.token1, quote.maximumWalletDebit1), ...tokenDebit(snapshot, selected.token2, quote.maximumWalletDebit2)],
			}),
		)
		const window = mode === 'dispute' && quote !== undefined ? disputeWindow(snapshot, selected, quote, options) : reportWindow(snapshot, selected, options)
		return planBase({
			deadlineTimestamp: mode === 'dispute' && window.timestampClock ? window.closes.toString() : undefined,
			definitionId: id,
			ecosystem: 'open-oracle',
			label: `${mode} OpenOracle report`,
			lastValidBlockNumber: mode === 'dispute' && !window.timestampClock ? (window.closes - 1n).toString() : undefined,
			maximumCleanupTransactionCount: mode === 'dispute' && steps.length > 1 ? steps.length - 1 : undefined,
			semanticDeadlineBlockNumber: mode === 'dispute' && !window.timestampClock ? (window.closes - 1n).toString() : undefined,
			metadata: {
				deadlineBlock: mode === 'dispute' && !window.timestampClock ? (window.closes - 1n).toString() : '0',
				...(quote === undefined
					? {}
					: {
							external1: quote.external1.toString(),
							external2: quote.external2.toString(),
							internal1: quote.internal1.toString(),
							internal2: quote.internal2.toString(),
							newAmount1: quote.new1.toString(),
							newAmount2: quote.new2.toString(),
							openOracle: selected.openOracle,
							token1: selected.token1,
							token2: selected.token2,
						}),
				reportId: selected.reportId,
				selfDispute: quote?.selfDispute ?? false,
				stateHash: selected.stateHash,
			},
			postconditions: [mode === 'settle' ? 'The report state has a nonzero settlement timestamp and ReportSettled is emitted' : 'The indexed report preimage advances to the disputed state'],
			priority: mode === 'settle' ? 'urgent' : 'random',
			risk: mode === 'settle' ? 'low' : 'high',
			snapshot,
			steps,
		})
	}
	const disputeContinuationMethods =
		mode === 'dispute'
			? {
					buildContinuationPlan(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext) {
						const openOracle = requiredMetadataAddress(context.previousPlan.metadata, 'openOracle')
						const token1 = requiredMetadataAddress(context.previousPlan.metadata, 'token1')
						const token2 = requiredMetadataAddress(context.previousPlan.metadata, 'token2')
						const external1 = requiredMetadataAmount(context.previousPlan.metadata, 'external1')
						const external2 = requiredMetadataAmount(context.previousPlan.metadata, 'external2')
						const requirements = [...(external1 === 0n || token1 === zeroAddress ? [] : [{ id: `approve-${token1}`, required: external1, spender: openOracle, token: token1 }]), ...(external2 === 0n || token2 === zeroAddress ? [] : [{ id: `approve-${token2}`, required: external2, spender: openOracle, token: token2 }])]
						const cleanup = () => openOracleCleanupPlan(snapshot, context, requirements, 'Clean up OpenOracle dispute approvals', 'high')
						if (context.continuationDisposition === 'cleanup-only') return cleanup()
						const reportId = requiredMetadataString(context.previousPlan.metadata, 'reportId')
						const stateHash = requiredMetadataString(context.previousPlan.metadata, 'stateHash')
						const selected = snapshot.reports.find(candidate => candidate.reportId === reportId)
						const quote = selected === undefined ? undefined : disputeQuote(snapshot, selected, options)
						const quoteMatches =
							quote !== undefined &&
							quote.affordable &&
							quote.external1 === external1 &&
							quote.external2 === external2 &&
							quote.internal1 === requiredMetadataAmount(context.previousPlan.metadata, 'internal1') &&
							quote.internal2 === requiredMetadataAmount(context.previousPlan.metadata, 'internal2') &&
							quote.new1 === requiredMetadataAmount(context.previousPlan.metadata, 'newAmount1') &&
							quote.new2 === requiredMetadataAmount(context.previousPlan.metadata, 'newAmount2') &&
							quote.selfDispute === requiredMetadataBoolean(context.previousPlan.metadata, 'selfDispute')
						if (
							options.allowHighRisk !== true ||
							selected === undefined ||
							selected.stateHash !== stateHash ||
							selected.openOracle.toLowerCase() !== openOracle.toLowerCase() ||
							selected.token1.toLowerCase() !== token1.toLowerCase() ||
							selected.token2.toLowerCase() !== token2.toLowerCase() ||
							snapshot.deployments.openOracle.toLowerCase() !== openOracle.toLowerCase() ||
							!disputableReport(snapshot, selected, options) ||
							!quoteMatches ||
							!preparedApprovalState(snapshot, context, requirements)
						)
							return cleanup()
						const rebuilt = build(snapshot, options, selected)
						if (rebuilt === undefined) return cleanup()
						const freshApprovals = rebuilt.steps.filter(step => step.id.startsWith('approve-'))
						const cleanupCount = cleanupApprovalRequirements(snapshot, context, requirements).length + freshApprovals.length
						return {
							...rebuilt,
							...(cleanupCount === 0 ? {} : { maximumCleanupTransactionCount: cleanupCount }),
							metadata: context.previousPlan.metadata,
						}
					},
				}
			: {}
	const settlementPresence = (snapshot: EcosystemSnapshot, options: PlanningOptions) => {
		const trustedReport = trustedReportPredicate(snapshot)
		return snapshot.reports.flatMap(selected => {
			if (!trustedReport(selected)) return []
			if (selected.settlementTimestamp !== '0') return []
			const window = reportWindow(snapshot, selected, options)
			if (window.current < window.closes) return []
			return [{ deadlineBlock: '0', reportId: selected.reportId, selfDispute: false, stateHash: selected.stateHash }]
		})
	}
	const lifecycleMethods =
		mode === 'settle'
			? {
					buildLifecyclePlans(snapshot: EcosystemSnapshot, options: PlanningOptions) {
						return candidates(snapshot, options).flatMap(selected => {
							const plan = build(snapshot, options, selected)
							return plan === undefined ? [] : [plan]
						})
					},
					enumerateLifecycleObstructingPresence(snapshot: EcosystemSnapshot, options: PlanningOptions) {
						return settlementPresence(snapshot, options)
					},
					enumerateLifecyclePresence(snapshot: EcosystemSnapshot, options: PlanningOptions) {
						return settlementPresence(snapshot, options)
					},
				}
			: {}
	return {
		buildPlan(snapshot, options) {
			const selected = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return selected === undefined ? undefined : build(snapshot, options, selected)
		},
		classification: mode === 'settle' ? 'lifecycle-obligation' : 'selectable',
		contract: 'OpenOracle',
		description: `${mode === 'settle' ? 'Settles a due indexed report as a lifecycle obligation' : 'Randomly selects a permissionless dispute during its bounded window without creating a recursive lifecycle obligation'} using its exact stored preimage.`,
		discoveryInputs: ['indexed report preimages', 'anchor time', 'token balances and approvals'],
		ecosystem: 'open-oracle',
		evaluate(snapshot, options) {
			const trustedReport = trustedReportPredicate(snapshot)
			const found = snapshot.reports.some(candidate => {
				if (!trustedReport(candidate)) return false
				if (candidate.settlementTimestamp !== '0') return false
				if (mode === 'dispute') return disputableReport(snapshot, candidate, options)
				const window = reportWindow(snapshot, candidate, options)
				return window.current >= window.closes
			})
			return eligible(mode === 'dispute' && options.allowHighRisk !== true ? 'High-risk operations are disabled' : undefined, found ? undefined : `No report is ready to ${mode}`)
		},
		id,
		label: `${mode} report`,
		method: mode,
		risk: mode === 'settle' ? 'low' : 'high',
		...disputeContinuationMethods,
		...lifecycleMethods,
	}
}
