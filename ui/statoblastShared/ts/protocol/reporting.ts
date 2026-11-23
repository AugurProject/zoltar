import { getReportingSubmissionTimingGuard } from './reportingTiming.js'
import * as reportingCopy from '../copy/reporting.js'
import * as portfolioCopy from '../copy/portfolio.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import { zeroAddress, type Address, type ContractFunctionParameters } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool, statoblast_SecurityPoolForker_SecurityPoolForker, statoblast_factories_EscalationGameFactory_EscalationGameFactory } from '../contractArtifact.js'
import { runFundingTransactions, type FundingTransaction } from './fundingTransactions.js'
import type { ReadClient, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { EscalationDeposit, EscalationSide, ReportingActionResult, ReportingDetails, ReportingSettlementState } from '../types/contracts.js'
import { readRequiredMulticall, writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { requireAddressValue, requireArrayValue, requireBigintValue, requireIntegerLikeValue, requireObjectValue, requireTupleValue } from './decoders.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { getReportingOutcomeKey, getReportingOutcomeValue, getSecurityPoolSystemState } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { getEscalationSideLabel, hasTimestamp } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { readSecurityPoolUniverseId } from './securityPoolActions.js'
import { SECURITY_POOL_QUESTION_OUTCOME_ABI } from './securityPoolAbi.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { loadForkCarriedEscalationDepositsFromParentSnapshot, readEscalationOutcomeState, readForkContinuation } from './reportingCarryState.js'
import { CONTRACT_PAGE_SIZE } from './pagination.js'

type ReportingBootstrapReadResult = {
	questionId: bigint
	escalationGameAddress: Address
	settlementCollateralAttoEth: bigint
	universeId: bigint
	zoltarAddress: Address
	initialEscalationGameDepositAttoRep: bigint
	systemStateValue: bigint | number
	questionOutcomeValue: bigint | number
	parentSecurityPoolAddress: Address
}

type EscalationDepositViewStruct = {
	amountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
	depositor: Address
}

function requireReportingBootstrapReadResult(value: unknown): ReportingBootstrapReadResult {
	const [questionId, escalationGameAddress, settlementCollateralAttoEth, universeId, zoltarAddress, initialEscalationGameDepositAttoRep, systemStateValue, questionOutcomeValue, parentSecurityPoolAddress] = requireTupleValue(value, 9, 'reporting bootstrap')
	return {
		questionId: requireBigintValue(questionId, 'reporting question id'),
		escalationGameAddress: requireAddressValue(escalationGameAddress, 'reporting escalation game address'),
		settlementCollateralAttoEth: requireBigintValue(settlementCollateralAttoEth, 'reporting complete set collateral amount'),
		universeId: requireBigintValue(universeId, 'reporting universe id'),
		zoltarAddress: requireAddressValue(zoltarAddress, 'reporting zoltar address'),
		initialEscalationGameDepositAttoRep: requireBigintValue(initialEscalationGameDepositAttoRep, 'reporting initial escalation game deposit'),
		systemStateValue: requireIntegerLikeValue(systemStateValue, 'reporting system state'),
		questionOutcomeValue: requireIntegerLikeValue(questionOutcomeValue, 'reporting question outcome'),
		parentSecurityPoolAddress: requireAddressValue(parentSecurityPoolAddress, 'reporting parent security pool address'),
	}
}

function requireEscalationDepositView(value: unknown, context: string): EscalationDepositViewStruct {
	const deposit = requireObjectValue(value, context)
	if ('amountAttoRep' in deposit && 'cumulativeAmountAttoRep' in deposit && 'depositor' in deposit) {
		return {
			amountAttoRep: requireBigintValue(deposit.amountAttoRep, context),
			cumulativeAmountAttoRep: requireBigintValue(deposit.cumulativeAmountAttoRep, context),
			depositor: requireAddressValue(deposit.depositor, context),
		}
	}
	throw new Error(`Unexpected ${context} response`)
}

function requireEscalationDepositArray(value: unknown, context: string): EscalationDepositViewStruct[] {
	return requireArrayValue(value, context).map(deposit => requireEscalationDepositView(deposit, context))
}

async function loadEscalationDeposits(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<EscalationDeposit[]> {
	let currentIndex = 0n
	const deposits: EscalationDeposit[] = []
	while (true) {
		const page = requireEscalationDepositArray(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				address: escalationGameAddress,
				functionName: 'getDepositsByOutcome',
				args: [getReportingOutcomeValue(outcome), currentIndex, CONTRACT_PAGE_SIZE],
			}),
			'escalation deposit page',
		)
		const normalizedPage = page
			.map((deposit, index) => ({
				amountAttoRep: deposit.amountAttoRep,
				cumulativeAmountAttoRep: deposit.cumulativeAmountAttoRep,
				depositIndex: currentIndex + BigInt(index),
				depositor: deposit.depositor,
			}))
			.filter(deposit => deposit.depositor !== zeroAddress && deposit.amountAttoRep > 0n)
		deposits.push(...normalizedPage)
		if (BigInt(page.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	}
	return deposits
}

async function loadViewerReportingWalletState(client: ReadClient, fundingAddress: Address, accountAddress: Address | undefined) {
	if (accountAddress === undefined) return { viewerWalletRepAllowanceAttoRep: undefined, viewerWalletRepBalanceAttoRep: undefined, viewerWalletRepTokenAddress: undefined }
	// Pools and games expose the same REP getter; the funding address is also the spender.
	const viewerWalletRepTokenAddress = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'repToken', address: fundingAddress, args: [] })
	const [viewerWalletRepBalanceAttoRep, viewerWalletRepAllowanceAttoRep] = await Promise.all([
		client.readContract({ abi: ABIS.mainnet.erc20, functionName: 'balanceOf', address: viewerWalletRepTokenAddress, args: [accountAddress] }),
		client.readContract({ abi: ABIS.mainnet.erc20, functionName: 'allowance', address: viewerWalletRepTokenAddress, args: [accountAddress, fundingAddress] }),
	])
	return { viewerWalletRepAllowanceAttoRep, viewerWalletRepBalanceAttoRep, viewerWalletRepTokenAddress }
}

export async function loadReportingDetails(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<ReportingDetails> {
	const reportingPoolReads: readonly ContractFunctionParameters[] = [
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'questionId',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'settlementCollateralAttoEth',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'universeId',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'zoltar',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'initialEscalationGameDepositAttoRep',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'systemState',
			address: securityPoolAddress,
			args: [],
		},
		{
			abi: SECURITY_POOL_QUESTION_OUTCOME_ABI,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		},
		{
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'parent',
			address: securityPoolAddress,
			args: [],
		},
	]
	const { questionId, escalationGameAddress, settlementCollateralAttoEth, universeId, zoltarAddress, initialEscalationGameDepositAttoRep, systemStateValue, questionOutcomeValue, parentSecurityPoolAddress } = requireReportingBootstrapReadResult(await readRequiredMulticall(client, reportingPoolReads))
	const systemState = getSecurityPoolSystemState(systemStateValue)
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
		const inheritedOutcome = parentSecurityPoolAddress !== zeroAddress && (await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddress, functionName: 'isEscalationResolved' }))
		const walletReportingState = await loadViewerReportingWalletState(client, securityPoolAddress, accountAddress)
		return {
			...(inheritedOutcome ? { reportingBlockedReason: reportingCopy.inheritedOutcomeReportingClosed } : {}),
			canTriggerOwnFork: false,
			contributionFunding: 'wallet',
			...walletReportingState,
			settlementCollateralAttoEth,
			currentTime: block.timestamp,
			forkThresholdAttoRep,
			marketDetails,
			nonDecisionThresholdAttoRep,
			parentSecurityPoolAddress,
			questionOutcome: normalizedQuestionOutcome,
			securityPoolAddress,
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
	const walletReportingStatePromise = loadViewerReportingWalletState(client, securityPoolAddress, accountAddress)
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
			abi: SECURITY_POOL_QUESTION_OUTCOME_ABI,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
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
	const useCarrySnapshot = forkContinuationSnapshot !== undefined
	const [invalidDeposits, yesDeposits, noDeposits, invalidParentSnapshotDeposits, yesParentSnapshotDeposits, noParentSnapshotDeposits] = await Promise.all([
		loadEscalationDeposits(client, escalationGameAddress, 'invalid'),
		loadEscalationDeposits(client, escalationGameAddress, 'yes'),
		loadEscalationDeposits(client, escalationGameAddress, 'no'),
		accountAddress === undefined || parentSecurityPoolAddress === zeroAddress || !useCarrySnapshot ? Promise.resolve([]) : loadForkCarriedEscalationDepositsFromParentSnapshot(client, escalationGameAddress, parentSecurityPoolAddress, 'invalid', accountAddress),
		accountAddress === undefined || parentSecurityPoolAddress === zeroAddress || !useCarrySnapshot ? Promise.resolve([]) : loadForkCarriedEscalationDepositsFromParentSnapshot(client, escalationGameAddress, parentSecurityPoolAddress, 'yes', accountAddress),
		accountAddress === undefined || parentSecurityPoolAddress === zeroAddress || !useCarrySnapshot ? Promise.resolve([]) : loadForkCarriedEscalationDepositsFromParentSnapshot(client, escalationGameAddress, parentSecurityPoolAddress, 'no', accountAddress),
	])
	const sides: EscalationSide[] = [
		{
			balance: balances[0] ?? 0n,
			deposits: invalidDeposits,
			importedUserDeposits: invalidParentSnapshotDeposits,
			key: 'invalid',
			label: getEscalationSideLabel('invalid'),
			userDeposits: accountAddress === undefined ? [] : invalidDeposits.filter(deposit => deposit.depositor === accountAddress),
		},
		{
			balance: balances[1] ?? 0n,
			deposits: yesDeposits,
			importedUserDeposits: yesParentSnapshotDeposits,
			key: 'yes',
			label: getEscalationSideLabel('yes'),
			userDeposits: accountAddress === undefined ? [] : yesDeposits.filter(deposit => deposit.depositor === accountAddress),
		},
		{
			balance: balances[2] ?? 0n,
			deposits: noDeposits,
			importedUserDeposits: noParentSnapshotDeposits,
			key: 'no',
			label: getEscalationSideLabel('no'),
			userDeposits: accountAddress === undefined ? [] : noDeposits.filter(deposit => deposit.depositor === accountAddress),
		},
	]
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

	return {
		...(reportingBlockedReason === undefined ? {} : { reportingBlockedReason }),
		canTriggerOwnFork,
		bindingCapital,
		contributionFunding: 'wallet',
		settlementCollateralAttoEth,
		currentRequiredBond: totalCostAttoRep === 0n ? startBondAttoRep : totalCostAttoRep,
		currentTime: block.timestamp,
		earliestForkTime,
		escalationEndTime,
		escalationGameAddress,
		forkThresholdAttoRep: settlementForkThreshold ?? forkThresholdAttoRep,
		hasReachedNonDecision,
		marketDetails,
		nonDecisionThresholdAttoRep,
		parentSecurityPoolAddress,
		questionOutcome: normalizedQuestionOutcome,
		securityPoolAddress,
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

export async function reportOutcomeInSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amountAttoRep: bigint, reviewAmountAttoRep = amountAttoRep, contributionFunding?: 'vault' | 'wallet', triggersFork = false, requireLead = false) {
	const [universeId, escalationGameAddress] = await Promise.all([
		readSecurityPoolUniverseId(client, securityPoolAddress),
		client.readContract({
			address: securityPoolAddress,
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			args: [],
		}),
	])
	if (contributionFunding === 'vault') throw new Error('Reports use wallet REP. Withdraw free REP from your portfolio before reporting.')
	if (escalationGameAddress !== zeroAddress) {
		const [escalationEndTime, block] = await Promise.all([client.readContract({ address: escalationGameAddress, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getEscalationGameEndDate', args: [] }), client.getBlock()])
		const timingGuard = getReportingSubmissionTimingGuard({ currentTime: block.timestamp, escalationEndTime })
		if (timingGuard !== undefined) throw new Error(timingGuard)
	}

	const callParams = {
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: requireLead ? 'depositWalletRepToEscalationGameWithLead' : 'depositWalletRepToEscalationGame',
		...getReportReviewText(outcome, reviewAmountAttoRep, triggersFork),
		args: [getReportingOutcomeValue(outcome), amountAttoRep],
	}
	const reportSteps = [
		{
			...callParams,
			contractAddress: securityPoolAddress,
			refreshFundingRequirements: async () => {
				const tokenAddress = await client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'repToken' })
				return [{ tokenAddress, amount: reviewAmountAttoRep }]
			},
			validateBeforeSubmit: async () => {
				const [currentGame, systemState] = await Promise.all([
					client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'escalationGame' }),
					client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'systemState' }),
				])
				if (currentGame !== escalationGameAddress || getSecurityPoolSystemState(systemState) !== 'operational') throw new Error('Reporting changed. Review the pool again.')
				if (currentGame !== zeroAddress) {
					const [endTime, acceptedDeposit] = await Promise.all([
						client.readContract({ address: currentGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getEscalationGameEndDate' }),
						client.readContract({ address: currentGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: requireLead ? 'previewLeadingDepositOnOutcome' : 'previewDepositOnOutcome', args: [getReportingOutcomeValue(outcome), amountAttoRep] }),
					])
					if (acceptedDeposit[0] !== reviewAmountAttoRep || acceptedDeposit[0] <= 0n) throw new Error('The report amount changed. Review the report again.')
					const block = await client.getBlock()
					const timingGuard = getReportingSubmissionTimingGuard({ currentTime: block.timestamp, escalationEndTime: endTime })
					if (timingGuard !== undefined) throw new Error(timingGuard)
				}
			},
		},
	] as const
	const gamePreparation = escalationGameAddress === zeroAddress ? await getEscalationGamePreparation(client, securityPoolAddress) : undefined
	if (gamePreparation === undefined) client.onTransactionPlan?.(reportSteps)
	else await runFundingTransactions(client, [gamePreparation], reportSteps[0])
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'reportOutcome',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}

/**
 * A question's first report would otherwise also deploy its Escalation Game, which can take the transaction close to
 * the per-transaction gas cap (#1453). Deploying the game first is permissionless and does not start its clock.
 */
async function getEscalationGamePreparation(client: WriteClient, securityPoolAddress: Address): Promise<FundingTransaction | undefined> {
	// Preparation costs real gas, so offer it only when the first report itself is currently allowed.
	const [systemState, questionData, questionId] = await Promise.all([
		client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'systemState' }),
		client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'questionData' }),
		client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'questionId' }),
	])
	if (getSecurityPoolSystemState(systemState) !== 'operational') throw new Error('Reporting changed. Review the pool again.')
	const [endTime, block] = await Promise.all([client.readContract({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionData, functionName: 'getQuestionEndDate', args: [questionId] }), client.getBlock()])
	if (block.timestamp < endTime) throw new Error('Reporting opens when the question ends.')
	const factory = await client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'escalationGameFactory' })
	const game = await client.readContract({ address: factory, abi: statoblast_factories_EscalationGameFactory_EscalationGameFactory.abi, functionName: 'escalationGameAddress', args: [securityPoolAddress] })
	const isRequired = async () => {
		const [currentGame, code] = await Promise.all([client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'escalationGame' }), client.getCode({ address: game })])
		return currentGame === zeroAddress && (code === undefined || code === '0x')
	}
	if (!(await isRequired())) return undefined
	const callParams = { address: factory, abi: statoblast_factories_EscalationGameFactory_EscalationGameFactory.abi, functionName: 'prepareEscalationGame', args: [securityPoolAddress] } as const
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

async function readOwnForkAdmissionSpend(client: ReadClient, securityPoolAddress: Address) {
	const [reporterLedger, shortfallAttoRep] = await client.readContract({ address: getInfraContractAddresses().securityPoolForker, abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi, functionName: 'getOwnForkAdmissionShortfall', args: [securityPoolAddress] })
	const repTokenAddress = await client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'repToken', args: [] })
	return { reporterLedger, repTokenAddress, shortfallAttoRep }
}

/**
 * Reads the REP an own-question fork pulls from its caller when the genesis fork threshold grew past the
 * question's escrow after the Escalation Game started, and the caller's allowance to the reporter ledger for it.
 */
export async function loadOwnForkAdmission(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<OwnForkAdmission> {
	const { reporterLedger, repTokenAddress, shortfallAttoRep } = await readOwnForkAdmissionSpend(client, securityPoolAddress)
	const allowanceAttoRep = accountAddress === undefined ? undefined : await client.readContract({ address: repTokenAddress, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [accountAddress, reporterLedger] })
	return { allowanceAttoRep, recommendedApprovalAttoRep: shortfallAttoRep === 0n ? 0n : shortfallAttoRep + OWN_FORK_ADMISSION_GROWTH_BUFFER_ATTO_REP, shortfallAttoRep }
}

/** Approves the reporter ledger to pull the selected amount of fork admission REP. */
export async function approveOwnForkAdmission(client: WriteClient, securityPoolAddress: Address, amountAttoRep: bigint) {
	const { reporterLedger, repTokenAddress } = await readOwnForkAdmissionSpend(client, securityPoolAddress)
	return await writeContractAndWait(client, () => ({
		address: repTokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [reporterLedger, amountAttoRep],
		reviewTitle: portfolioCopy.approveForkAdmission,
		reviewDescription: portfolioCopy.approveForkAdmissionDescription,
	}))
}

/** Sends only the fork; the caller must already have approved any fork admission shortfall. */
export async function forkWithOwnEscalationGame(client: WriteClient, securityPoolAddress: Address) {
	const admission = await loadOwnForkAdmission(client, securityPoolAddress, client.account.address)
	if (admission.shortfallAttoRep > 0n && (admission.allowanceAttoRep ?? 0n) < admission.shortfallAttoRep) throw new Error(portfolioCopy.forkAdmissionApprovalRequired)
	return await writeContractAndWait(client, () => ({
		address: getInfraContractAddresses().securityPoolForker,
		abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
		functionName: 'forkZoltarWithOwnEscalationGame',
		args: [securityPoolAddress],
		reviewTitle: portfolioCopy.triggerUniverseFork,
		reviewDescription: portfolioCopy.triggerUniverseForkDescription,
	}))
}

export async function approveReportingRep(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amountAttoRep: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const fundingAddress = securityPoolAddress
	const repTokenAddress = await client.readContract({ address: fundingAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'repToken', args: [] })
	const hash = await writeContractAndWait(client, () => ({
		address: repTokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [fundingAddress, amountAttoRep],
	}))
	return { action: 'approveReportingRep', hash, outcome, securityPoolAddress, universeId } satisfies ReportingActionResult
}

export async function withdrawEscalationFromSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[], claimAmountAttoRep?: bigint) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	let reviewTitle = transactionCopy.settleEscalationDeposits
	if (claimAmountAttoRep !== undefined) reviewTitle = claimAmountAttoRep === 0n ? reportingCopy.clearDeposits(getEscalationSideLabel(outcome)) : reportingCopy.claimDeposits(getEscalationSideLabel(outcome), formatCurrencyBalance(claimAmountAttoRep))
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'withdrawFromEscalationGame',
		reviewTitle,
		...(claimAmountAttoRep === 0n ? { reviewDescription: reportingCopy.clearLosingDepositsReviewDescription } : {}),
		args: [getReportingOutcomeValue(outcome), depositIndexes],
	}))
	return {
		action: 'withdrawEscalation',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}
