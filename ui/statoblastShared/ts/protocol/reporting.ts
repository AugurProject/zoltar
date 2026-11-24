import { getReportingSubmissionTimingGuard } from './reportingTiming.js'
import * as reportingCopy from '../copy/reporting.js'
import * as securityPoolCopy from '../copy/securityPool.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import { zeroAddress, type Address, type ContractFunctionParameters } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_EscalationGame_EscalationGame, statoblast_QuestionLedger_QuestionLedger, statoblast_QuestionForker_QuestionForker, statoblast_factories_EscalationGameFactory_EscalationGameFactory, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '../contractArtifact.js'
import { runFundingTransactions, type FundingTransaction } from './fundingTransactions.js'
import type { ReadClient, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { EscalationSide, ReportingActionResult, ReportingDetails, ReportingSettlementState } from '../types/contracts.js'
import { readRequiredMulticall, writeContractAndWait, writeContractAndWaitForReceipt } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { requireAddressValue, requireBigintValue, requireIntegerLikeValue, requireTupleValue } from './decoders.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { getReportingOutcomeKey, getReportingOutcomeValue, getQuestionLedgerSystemState } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { getEscalationSideLabel, hasTimestamp } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { readQuestionLedgerUniverseId } from './questionLedgerActions.js'
import { QUESTION_LEDGER_QUESTION_OUTCOME_ABI } from './questionLedgerAbi.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { readEscalationOutcomeState, readForkContinuation } from './reportingCarryState.js'
import { captureReportingDeposits, reportingDepositStore } from './reportingDeposits.js'
import { readLocatedReportingDeposits } from './reportingDepositSearch.js'
import { getRuntimeNetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { readWinningClaimReview } from './reportingClaimReview.js'

type ReportingBootstrapReadResult = {
	questionId: bigint
	escalationGameAddress: Address
	settlementCollateralAttoEth: bigint
	universeId: bigint
	zoltarAddress: Address
	initialEscalationGameDepositAttoRep: bigint
	systemStateValue: bigint | number
	questionOutcomeValue: bigint | number
	parentQuestionLedgerAddress: Address
}

function requireReportingBootstrapReadResult(value: unknown): ReportingBootstrapReadResult {
	const [questionId, escalationGameAddress, settlementCollateralAttoEth, universeId, zoltarAddress, initialEscalationGameDepositAttoRep, systemStateValue, questionOutcomeValue, parentQuestionLedgerAddress] = requireTupleValue(value, 9, 'reporting bootstrap')
	return {
		questionId: requireBigintValue(questionId, 'reporting question id'),
		escalationGameAddress: requireAddressValue(escalationGameAddress, 'reporting game address'),
		settlementCollateralAttoEth: requireBigintValue(settlementCollateralAttoEth, 'reporting complete set collateral amount'),
		universeId: requireBigintValue(universeId, 'reporting universe id'),
		zoltarAddress: requireAddressValue(zoltarAddress, 'reporting zoltar address'),
		initialEscalationGameDepositAttoRep: requireBigintValue(initialEscalationGameDepositAttoRep, 'minimum first report'),
		systemStateValue: requireIntegerLikeValue(systemStateValue, 'reporting system state'),
		questionOutcomeValue: requireIntegerLikeValue(questionOutcomeValue, 'reporting question outcome'),
		parentQuestionLedgerAddress: requireAddressValue(parentQuestionLedgerAddress, 'reporting parent question ledger address'),
	}
}

async function loadViewerReportingWalletState(client: ReadClient, fundingAddress: Address, accountAddress: Address | undefined) {
	if (accountAddress === undefined) return { viewerWalletRepAllowanceAttoRep: undefined, viewerWalletRepBalanceAttoRep: undefined, viewerWalletRepTokenAddress: undefined }
	// Pools and games expose the same REP getter; the funding address is also the spender.
	const viewerWalletRepTokenAddress = await client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'repToken', address: fundingAddress, args: [] })
	const [viewerWalletRepBalanceAttoRep, viewerWalletRepAllowanceAttoRep] = await Promise.all([
		client.readContract({ abi: ABIS.mainnet.erc20, functionName: 'balanceOf', address: viewerWalletRepTokenAddress, args: [accountAddress] }),
		client.readContract({ abi: ABIS.mainnet.erc20, functionName: 'allowance', address: viewerWalletRepTokenAddress, args: [accountAddress, fundingAddress] }),
	])
	return { viewerWalletRepAllowanceAttoRep, viewerWalletRepBalanceAttoRep, viewerWalletRepTokenAddress }
}

export async function loadReportingDetails(client: ReadClient, questionLedgerAddress: Address, accountAddress: Address | undefined, includeSchedule = false): Promise<ReportingDetails> {
	const reportingPoolReads: readonly ContractFunctionParameters[] = [
		{
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'questionId',
			address: questionLedgerAddress,
			args: [],
		},
		{
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'escalationGame',
			address: questionLedgerAddress,
			args: [],
		},
		{
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'settlementCollateralAttoEth',
			address: questionLedgerAddress,
			args: [],
		},
		{
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'universeId',
			address: questionLedgerAddress,
			args: [],
		},
		{
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'zoltar',
			address: questionLedgerAddress,
			args: [],
		},
		{
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'initialEscalationGameDepositAttoRep',
			address: questionLedgerAddress,
			args: [],
		},
		{
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'systemState',
			address: questionLedgerAddress,
			args: [],
		},
		{
			abi: QUESTION_LEDGER_QUESTION_OUTCOME_ABI,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().questionForker,
			args: [questionLedgerAddress],
		},
		{
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'parent',
			address: questionLedgerAddress,
			args: [],
		},
	]
	const { questionId, escalationGameAddress, settlementCollateralAttoEth, universeId, zoltarAddress, initialEscalationGameDepositAttoRep, systemStateValue, questionOutcomeValue, parentQuestionLedgerAddress } = requireReportingBootstrapReadResult(await readRequiredMulticall(client, reportingPoolReads))
	const systemState = getQuestionLedgerSystemState(systemStateValue)
	const normalizedQuestionOutcome = getReportingOutcomeKey(questionOutcomeValue)
	const [marketDetails, block, escalationGameCode, forkThresholdAttoRep] = await Promise.all([
		loadMarketDetails(client, questionId),
		client.getBlock(),
		escalationGameAddress === zeroAddress ? Promise.resolve('0x' as const) : client.getCode({ address: escalationGameAddress }),
		client.readContract({
			abi: Zoltar_Zoltar.abi,
			address: zoltarAddress,
			functionName: 'getForkThresholdAttoRep',
			args: [universeId],
		}),
	])
	if (!hasTimestamp(block)) throw new Error('Unexpected block response')
	if (escalationGameAddress === zeroAddress || escalationGameCode === undefined || escalationGameCode === '0x') {
		const nonDecisionThresholdAttoRep = forkThresholdAttoRep / 2n + (forkThresholdAttoRep % 2n)
		const startBondAttoRep = nonDecisionThresholdAttoRep > 1n && initialEscalationGameDepositAttoRep >= nonDecisionThresholdAttoRep ? nonDecisionThresholdAttoRep - 1n : initialEscalationGameDepositAttoRep
		const inheritedOutcome = parentQuestionLedgerAddress !== zeroAddress && (await client.readContract({ abi: statoblast_QuestionLedger_QuestionLedger.abi, address: questionLedgerAddress, functionName: 'isEscalationResolved' }))
		const walletReportingState = await loadViewerReportingWalletState(client, questionLedgerAddress, accountAddress)
		return {
			...(inheritedOutcome ? { reportingBlockedReason: reportingCopy.inheritedOutcomeReportingClosed } : {}),
			canTriggerOwnFork: false,
			...walletReportingState,
			settlementCollateralAttoEth,
			currentTime: block.timestamp,
			forkThresholdAttoRep,
			marketDetails,
			nonDecisionThresholdAttoRep,
			parentQuestionLedgerAddress,
			questionOutcome: normalizedQuestionOutcome,
			questionLedgerAddress,
			settlementState: normalizedQuestionOutcome !== 'none' && systemState === 'operational' ? 'resolved' : 'locked',
			startBondAttoRep,
			status: 'not-started',
			systemState,
			universeId,
			parentWithdrawalEnabled: false,
		}
	}
	const forkContinuationSnapshot = await readForkContinuation(client, escalationGameAddress)
	// Every accepted deposit and a continuation's resume record the threshold settlement scales by; zero means the game never changed.
	const recordedForkThreshold = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'settlementForkThresholdAttoRep' })
	const settlementForkThreshold = recordedForkThreshold === 0n ? undefined : recordedForkThreshold
	const continuationTiming = forkContinuationSnapshot
		? await Promise.all([
				client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'forkResumedAt', args: [] }),
				client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'forkElapsedAtStart', args: [] }),
				client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'fixedQuestionOutcome', args: [] }),
			])
		: undefined
	const walletReportingStatePromise = loadViewerReportingWalletState(client, questionLedgerAddress, accountAddress)
	const [startBondAttoRep, nonDecisionThresholdAttoRep, activationTime, totalCostAttoRep, bindingCapital, invalidOutcomeState, yesOutcomeState, noOutcomeState, escalationEndTime, _questionOutcome, universeForkTime, earliestForkTime, hasReachedNonDecision, walletReportingState] = await Promise.all([
		client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'startBondAttoRep',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'nonDecisionThresholdAttoRep',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'activationTime',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'totalCostAttoRep',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getBindingCapitalAttoRep',
			address: escalationGameAddress,
			args: [],
		}),
		readEscalationOutcomeState(client, escalationGameAddress, 'invalid'),
		readEscalationOutcomeState(client, escalationGameAddress, 'yes'),
		readEscalationOutcomeState(client, escalationGameAddress, 'no'),
		client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getEscalationGameEndDate',
			address: escalationGameAddress,
			args: [],
		}),
		client.readContract({
			abi: QUESTION_LEDGER_QUESTION_OUTCOME_ABI,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().questionForker,
			args: [questionLedgerAddress],
		}),
		client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getForkTime',
			address: getInfraContractAddresses().zoltar,
			args: [universeId],
		}),
		client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'getEarliestForkTime',
			address: getInfraContractAddresses().zoltar,
			args: [universeId],
		}),
		client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'hasReachedNonDecision',
			address: escalationGameAddress,
			args: [],
		}),
		walletReportingStatePromise,
	])
	const balances: [bigint, bigint, bigint] = [invalidOutcomeState.balanceAttoRep, yesOutcomeState.balanceAttoRep, noOutcomeState.balanceAttoRep]
	const securityPool =
		accountAddress === undefined
			? undefined
			: await client.readContract({
					abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
					address: getInfraContractAddresses().securityPoolFactory,
					functionName: 'securityPoolOf',
					args: [questionLedgerAddress],
					blockNumber: block.number,
				})
	const located = accountAddress === undefined ? [] : reportingDepositStore(getRuntimeNetworkProfile()).read()
	const reportingDepositPool = securityPool === zeroAddress ? undefined : securityPool
	const outcomes = ['invalid', 'yes', 'no'] as const
	const sides: EscalationSide[] = await Promise.all(
		outcomes.map(async (outcome, index) => {
			const local = reportingDepositPool === undefined || accountAddress === undefined || block.number === undefined ? undefined : await readLocatedReportingDeposits(client, escalationGameAddress, { pool: reportingDepositPool, questionId, universeId, outcome, depositor: accountAddress }, located, block.number)
			const deposits = local?.deposits ?? []
			return {
				balance: balances[index] ?? 0n,
				deposits,
				importedUserDeposits: [],
				key: outcome,
				label: getEscalationSideLabel(outcome),
				localPrincipalAttoRep: local?.total,
				userDeposits: deposits.filter(deposit => deposit.amountAttoRep > 0n),
			}
		}),
	)
	let settlementState: ReportingSettlementState = 'locked'
	if (normalizedQuestionOutcome !== 'none' && systemState === 'operational') {
		settlementState = 'resolved'
	} else if (universeForkTime > 0n && universeForkTime <= escalationEndTime && hasReachedNonDecision === false) {
		settlementState = 'migration-required'
	}
	const canTriggerOwnFork = hasReachedNonDecision && (await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'canTriggerOwnFork' }))
	let reportingBlockedReason: string | undefined
	if (continuationTiming?.[2] !== undefined && getReportingOutcomeKey(continuationTiming[2]) !== 'none') reportingBlockedReason = reportingCopy.inheritedOutcomeReportingClosed
	else if (forkContinuationSnapshot && continuationTiming?.[0] === 0n) reportingBlockedReason = reportingCopy.continuationNotResumed
	let latestEscalationEndTime: bigint | undefined
	if (includeSchedule && settlementState === 'locked' && !hasReachedNonDecision && reportingBlockedReason === undefined) {
		const duration = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'computeTimeSinceStartFromAttritionCostAttoRep', args: [nonDecisionThresholdAttoRep], blockNumber: block.number })
		if (continuationTiming === undefined) latestEscalationEndTime = activationTime + duration
		else latestEscalationEndTime = continuationTiming[0] + (duration > continuationTiming[1] ? duration - continuationTiming[1] : 0n)
	}

	return {
		...(reportingBlockedReason === undefined ? {} : { reportingBlockedReason }),
		canTriggerOwnFork,
		bindingCapital,
		settlementCollateralAttoEth,
		currentRequiredBond: totalCostAttoRep === 0n ? startBondAttoRep : totalCostAttoRep,
		currentTime: block.timestamp,
		earliestForkTime,
		escalationEndTime,
		latestEscalationEndTime,
		escalationGameAddress,
		reportingDepositPool,
		reportingQuestionId: questionId,
		forkThresholdAttoRep: settlementForkThreshold ?? forkThresholdAttoRep,
		hasReachedNonDecision,
		marketDetails,
		nonDecisionThresholdAttoRep,
		parentQuestionLedgerAddress,
		questionOutcome: normalizedQuestionOutcome,
		questionLedgerAddress,
		sides,
		startBondAttoRep,
		status: 'active',
		systemState,
		settlementState,
		activationTime,
		totalCostAttoRep,
		forkContinuation: forkContinuationSnapshot,
		forkResumedAt: continuationTiming?.[0],
		forkElapsedAtStart: continuationTiming?.[1],
		universeId,
		parentWithdrawalEnabled: settlementState === 'resolved',
		...walletReportingState,
	}
}

/** A fork-triggering wallet report always includes the fork consequence in its review. */
function getReportReviewText(outcome: ReportingOutcomeKey, amountAttoRep: bigint, triggersFork: boolean) {
	const outcomeLabel = getEscalationSideLabel(outcome)
	const amount = formatCurrencyBalance(amountAttoRep)
	return {
		reviewTitle: triggersFork ? reportingCopy.reportForkReviewTitle(outcomeLabel, amount) : transactionCopy.reportingAction(outcomeLabel, amount),
		reviewDescription: triggersFork ? reportingCopy.reportForkReviewDescription(outcomeLabel) : reportingCopy.reportReviewDescription(outcomeLabel),
		reviewAmount: formatCurrencyBalanceWithUnit(amountAttoRep, commonCopy.rep),
	}
}

export async function reportOutcomeInQuestionLedger(client: WriteClient, questionLedgerAddress: Address, outcome: ReportingOutcomeKey, amountAttoRep: bigint, reviewAmountAttoRep = amountAttoRep, triggersFork = false, requireLead = false) {
	const profile = getRuntimeNetworkProfile()
	const [universeId, escalationGameAddress] = await Promise.all([
		readQuestionLedgerUniverseId(client, questionLedgerAddress),
		client.readContract({
			address: questionLedgerAddress,
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'escalationGame',
			args: [],
		}),
	])
	if (escalationGameAddress !== zeroAddress) {
		const [escalationEndTime, block] = await Promise.all([client.readContract({ address: escalationGameAddress, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getEscalationGameEndDate', args: [] }), client.getBlock()])
		const timingGuard = getReportingSubmissionTimingGuard({ currentTime: block.timestamp, escalationEndTime })
		if (timingGuard !== undefined) throw new Error(timingGuard)
	}

	const callParams = {
		address: questionLedgerAddress,
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		functionName: requireLead ? 'depositWalletRepToEscalationGameWithLead' : 'depositWalletRepToEscalationGame',
		...getReportReviewText(outcome, reviewAmountAttoRep, triggersFork),
		args: [getReportingOutcomeValue(outcome), amountAttoRep],
	}
	let reviewRows: readonly { label: string; value: string }[] = []
	const reportSteps = [
		{
			...callParams,
			contractAddress: questionLedgerAddress,
			readReviewRows: () => reviewRows,
			refreshFundingRequirements: async () => {
				const tokenAddress = await client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'repToken' })
				return [{ tokenAddress, amount: reviewAmountAttoRep }]
			},
			validateBeforeSubmit: async () => {
				const block = await client.getBlock()
				if (block.number === undefined) throw new Error(transactionCopy.currentStateCheckFailed)
				const blockNumber = block.number
				const [currentGame, systemState] = await Promise.all([
					client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'escalationGame', blockNumber }),
					client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'systemState', blockNumber }),
				])
				if (currentGame !== escalationGameAddress || getQuestionLedgerSystemState(systemState) !== 'operational') throw new Error('Reporting changed. Review the question again.')
				if (currentGame !== zeroAddress) {
					const [endTime, acceptedDeposit] = await Promise.all([
						client.readContract({ address: currentGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getEscalationGameEndDate', blockNumber }),
						client.readContract({ address: currentGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: requireLead ? 'previewLeadingDepositOnOutcome' : 'previewDepositOnOutcome', args: [getReportingOutcomeValue(outcome), amountAttoRep], blockNumber }),
					])
					if (acceptedDeposit[0] !== reviewAmountAttoRep || acceptedDeposit[0] <= 0n) throw new Error('The report amount changed. Review the report again.')
					const timingGuard = getReportingSubmissionTimingGuard({ currentTime: block.timestamp, escalationEndTime: endTime })
					if (timingGuard !== undefined) throw new Error(timingGuard)
					if (!triggersFork) {
						const threshold = await client.readContract({ address: currentGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'nonDecisionThresholdAttoRep', blockNumber })
						if (acceptedDeposit[1] === threshold) {
							const balances = await client.readContract({ address: currentGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getOutcomeBalancesAttoRep', blockNumber })
							if (balances.some((balance, index) => index !== getReportingOutcomeValue(outcome) && balance >= threshold)) throw new Error(reportingCopy.forkTriggerChangedSinceReview)
						}
					}
				}
				const wallet = client.account.address
				const repToken = await client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'repToken', blockNumber })
				const [walletRep, stakedRep] = await Promise.all([
					client.readContract({ address: repToken, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [wallet], blockNumber }),
					currentGame === zeroAddress ? 0n : client.readContract({ address: currentGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome', args: [wallet, getReportingOutcomeValue(outcome)], blockNumber }),
				])
				if (walletRep < reviewAmountAttoRep) throw new Error(reportingCopy.reportReviewInsufficientRep)
				const comparison = (before: bigint, after: bigint) => `${formatCurrencyBalanceWithUnit(before, commonCopy.rep)} → ${formatCurrencyBalanceWithUnit(after, commonCopy.rep)}`
				reviewRows = [
					{ label: reportingCopy.walletRepReviewLabel, value: comparison(walletRep, walletRep - reviewAmountAttoRep) },
					{ label: reportingCopy.stakedRepReviewLabel(getEscalationSideLabel(outcome)), value: comparison(stakedRep, stakedRep + reviewAmountAttoRep) },
				]
			},
		},
	] as const
	const gamePreparation = escalationGameAddress === zeroAddress ? await getEscalationGamePreparation(client, questionLedgerAddress) : undefined
	if (gamePreparation === undefined) client.onTransactionPlan?.(reportSteps)
	else await runFundingTransactions(client, [gamePreparation], reportSteps[0])
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => callParams)
	// A confirmed report remains successful if receipt metadata cannot be saved on this device.
	await withTimeout(captureReportingDeposits(client, profile, questionLedgerAddress, universeId, receipt), 15_000, 'Saving the report deposit timed out.').catch(() => undefined)
	return {
		action: 'reportOutcome',
		hash,
		outcome,
		questionLedgerAddress,
		universeId,
	} satisfies ReportingActionResult
}

/**
 * A question's first report would otherwise also deploy its Escalation Game, which can take the transaction close to
 * the per-transaction gas cap (#1453). Deploying the game first is permissionless and does not start its clock.
 */
async function getEscalationGamePreparation(client: WriteClient, questionLedgerAddress: Address): Promise<FundingTransaction | undefined> {
	// Preparation costs real gas, so offer it only when the first report itself is currently allowed.
	const [systemState, questionData, questionId] = await Promise.all([
		client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'systemState' }),
		client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'questionData' }),
		client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'questionId' }),
	])
	if (getQuestionLedgerSystemState(systemState) !== 'operational') throw new Error('Reporting changed. Review the question again.')
	const [endTime, block] = await Promise.all([client.readContract({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionData, functionName: 'getQuestionEndDate', args: [questionId] }), client.getBlock()])
	if (block.timestamp < endTime) throw new Error('Reporting opens when the question ends.')
	const factory = await client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'escalationGameFactory' })
	const game = await client.readContract({ address: factory, abi: statoblast_factories_EscalationGameFactory_EscalationGameFactory.abi, functionName: 'escalationGameAddress', args: [questionLedgerAddress] })
	const isRequired = async () => {
		const [currentGame, code] = await Promise.all([client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'escalationGame' }), client.getCode({ address: game })])
		return currentGame === zeroAddress && (code === undefined || code === '0x')
	}
	if (!(await isRequired())) return undefined
	const callParams = { address: factory, abi: statoblast_factories_EscalationGameFactory_EscalationGameFactory.abi, functionName: 'prepareEscalationGame', args: [questionLedgerAddress] } as const
	return {
		step: { functionName: callParams.functionName, contractAddress: factory, args: callParams.args },
		isRequired,
		execute: async () => await writeContractAndWait(client, () => callParams),
	}
}

// The external genesis REP keeps minting between the approval and the fork transaction.
const OWN_FORK_ADMISSION_GROWTH_BUFFER_ATTO_REP = 10n ** 18n

export type OwnForkAdmission = {
	/** The viewer's REP allowance to the reporter ledger; undefined without a wallet or when nothing is owed. */
	allowanceAttoRep: bigint | undefined
	/** The shortfall plus a buffer for REP supply growth before the fork confirms. */
	recommendedApprovalAttoRep: bigint
	shortfallAttoRep: bigint
}

async function readOwnForkAdmissionSpend(client: ReadClient, questionLedgerAddress: Address) {
	const [reporterLedger, shortfallAttoRep] = await client.readContract({ address: getInfraContractAddresses().questionForker, abi: statoblast_QuestionForker_QuestionForker.abi, functionName: 'getOwnForkAdmissionShortfall', args: [questionLedgerAddress] })
	const repTokenAddress = await client.readContract({ address: questionLedgerAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'repToken', args: [] })
	return { reporterLedger, repTokenAddress, shortfallAttoRep }
}

/**
 * Reads the REP an own-question fork pulls from its caller when the genesis fork threshold grew past the
 * question's escrow after the Escalation Game started, and the caller's allowance to the reporter ledger for it.
 */
export async function loadOwnForkAdmission(client: ReadClient, questionLedgerAddress: Address, accountAddress: Address | undefined): Promise<OwnForkAdmission> {
	const { reporterLedger, repTokenAddress, shortfallAttoRep } = await readOwnForkAdmissionSpend(client, questionLedgerAddress)
	const allowanceAttoRep = accountAddress === undefined ? undefined : await client.readContract({ address: repTokenAddress, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [accountAddress, reporterLedger] })
	return { allowanceAttoRep, recommendedApprovalAttoRep: shortfallAttoRep === 0n ? 0n : shortfallAttoRep + OWN_FORK_ADMISSION_GROWTH_BUFFER_ATTO_REP, shortfallAttoRep }
}

/** Approves the reporter ledger to pull the selected amount of fork admission REP. */
export async function approveOwnForkAdmission(client: WriteClient, questionLedgerAddress: Address, amountAttoRep: bigint) {
	const { reporterLedger, repTokenAddress } = await readOwnForkAdmissionSpend(client, questionLedgerAddress)
	return await writeContractAndWait(client, () => ({
		address: repTokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [reporterLedger, amountAttoRep],
		reviewTitle: securityPoolCopy.approveForkAdmission,
		reviewDescription: securityPoolCopy.approveForkAdmissionDescription,
	}))
}

/** Sends only the fork; the caller must already have approved any fork admission shortfall. */
export async function forkWithOwnEscalationGame(client: WriteClient, questionLedgerAddress: Address) {
	const admission = await loadOwnForkAdmission(client, questionLedgerAddress, client.account.address)
	if (admission.shortfallAttoRep > 0n && (admission.allowanceAttoRep ?? 0n) < admission.shortfallAttoRep) throw new Error(securityPoolCopy.forkAdmissionApprovalRequired)
	return await writeContractAndWait(client, () => ({
		address: getInfraContractAddresses().questionForker,
		abi: statoblast_QuestionForker_QuestionForker.abi,
		functionName: 'forkZoltarWithOwnEscalationGame',
		args: [questionLedgerAddress],
		reviewTitle: securityPoolCopy.triggerUniverseFork,
		reviewDescription: securityPoolCopy.triggerUniverseForkDescription,
	}))
}

export async function approveReportingRep(client: WriteClient, questionLedgerAddress: Address, outcome: ReportingOutcomeKey, amountAttoRep: bigint) {
	const universeId = await readQuestionLedgerUniverseId(client, questionLedgerAddress)
	const fundingAddress = questionLedgerAddress
	const repTokenAddress = await client.readContract({ address: fundingAddress, abi: statoblast_QuestionLedger_QuestionLedger.abi, functionName: 'repToken', args: [] })
	const hash = await writeContractAndWait(client, () => ({
		address: repTokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [fundingAddress, amountAttoRep],
	}))
	return { action: 'approveReportingRep', hash, outcome, questionLedgerAddress, universeId } satisfies ReportingActionResult
}

export async function withdrawEscalationFromQuestionLedger(client: WriteClient, questionLedgerAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[], claimAmountAttoRep?: bigint) {
	const universeId = await readQuestionLedgerUniverseId(client, questionLedgerAddress)
	let reviewTitle = transactionCopy.settleEscalationDeposits
	if (claimAmountAttoRep !== undefined) reviewTitle = claimAmountAttoRep === 0n ? reportingCopy.clearDeposits(getEscalationSideLabel(outcome)) : reportingCopy.claimDeposits(getEscalationSideLabel(outcome), formatCurrencyBalance(claimAmountAttoRep))
	const callParams = {
		address: questionLedgerAddress,
		abi: statoblast_QuestionLedger_QuestionLedger.abi,
		functionName: 'withdrawFromEscalationGame',
		reviewTitle,
		...(claimAmountAttoRep === 0n ? { reviewDescription: reportingCopy.clearLosingDepositsReviewDescription } : {}),
		args: [getReportingOutcomeValue(outcome), depositIndexes],
	} as const
	if (claimAmountAttoRep !== undefined && claimAmountAttoRep > 0n) {
		let rows: readonly { label: string; value: string }[] = []
		client.onTransactionPlan?.([
			{
				...callParams,
				contractAddress: questionLedgerAddress,
				readReviewRows: () => rows,
				validateBeforeSubmit: async () => {
					const { wallet, payout } = await readWinningClaimReview(client, questionLedgerAddress, outcome, depositIndexes)
					if (payout !== claimAmountAttoRep) throw new Error(reportingCopy.claimPayoutChangedSinceReview)
					const rep = (amount: bigint) => formatCurrencyBalanceWithUnit(amount, commonCopy.rep)
					rows = [
						{ label: reportingCopy.claimPayoutReviewLabel, value: rep(payout) },
						{ label: reportingCopy.walletRepReviewLabel, value: `${rep(wallet)} → ${rep(wallet + payout)}` },
					]
				},
			},
		])
	}
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'withdrawEscalation',
		hash,
		outcome,
		questionLedgerAddress,
		universeId,
	} satisfies ReportingActionResult
}
