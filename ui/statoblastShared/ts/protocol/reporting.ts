import { getReportingSubmissionTimingGuard } from './reportingTiming.js'
import * as reportingCopy from '../copy/reporting.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import { zeroAddress, type Address, type ContractFunctionParameters } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool } from '../contractArtifact.js'
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
		const walletReportingState = await loadViewerReportingWalletState(client, securityPoolAddress, accountAddress)
		return {
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
	const ordinarySettlementInitialized = !forkContinuationSnapshot && (await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'ordinarySettlementInitialized' }))
	const frozenOrdinaryForkThreshold = ordinarySettlementInitialized ? await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'ordinarySettlementForkThresholdAttoRep' }) : undefined
	const continuationTiming = forkContinuationSnapshot
		? await Promise.all([
				client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'forkResumedAt', args: [] }),
				client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'forkElapsedAtStart', args: [] }),
			])
		: undefined
	const walletReportingStatePromise = loadViewerReportingWalletState(client, securityPoolAddress, accountAddress)
	const [startBondAttoRep, nonDecisionThresholdAttoRep, activationTime, totalCostAttoRep, bindingCapital, invalidOutcomeState, yesOutcomeState, noOutcomeState, escalationEndTime, _questionOutcome, universeForkTime, hasReachedNonDecision, walletReportingState] = await Promise.all([
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
	} else if (universeForkTime > 0n && universeForkTime < escalationEndTime && hasReachedNonDecision === false) {
		settlementState = 'migration-required'
	}
	return {
		bindingCapital,
		contributionFunding: 'wallet',
		settlementCollateralAttoEth,
		currentRequiredBond: totalCostAttoRep === 0n ? startBondAttoRep : totalCostAttoRep,
		currentTime: block.timestamp,
		escalationEndTime,
		escalationGameAddress,
		forkThresholdAttoRep: frozenOrdinaryForkThreshold ?? (universeForkTime > escalationEndTime ? nonDecisionThresholdAttoRep : forkThresholdAttoRep),
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

export async function reportOutcomeInSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amountAttoRep: bigint, reviewAmountAttoRep = amountAttoRep, contributionFunding?: 'vault' | 'wallet', triggersFork = false) {
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
		functionName: 'depositWalletRepToEscalationGame',
		...getReportReviewText(outcome, reviewAmountAttoRep, triggersFork),
		args: [getReportingOutcomeValue(outcome), amountAttoRep],
	}
	client.onTransactionPlan?.([
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
						client.readContract({ address: currentGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'previewDepositOnOutcome', args: [getReportingOutcomeValue(outcome), amountAttoRep] }),
					])
					if (acceptedDeposit[0] !== reviewAmountAttoRep || acceptedDeposit[0] <= 0n) throw new Error('The report amount changed. Review the report again.')
					const block = await client.getBlock()
					const timingGuard = getReportingSubmissionTimingGuard({ currentTime: block.timestamp, escalationEndTime: endTime })
					if (timingGuard !== undefined) throw new Error(timingGuard)
				}
			},
		},
	])
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'reportOutcome',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
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
