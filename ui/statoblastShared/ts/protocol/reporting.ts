import { zeroAddress, type Address, type ContractFunctionParameters } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_EscalationGame_EscalationGame, statoblast_SecurityPool_SecurityPool } from '../contractArtifact.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { EscalationDeposit, EscalationSide, ReadClient, ReportingActionResult, ReportingDetails, ReportingOutcomeKey, ReportingSettlementState, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { readRequiredMulticall, writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { requireAddressValue, requireArrayValue, requireBigintValue, requireIntegerLikeValue, requireObjectValue, requireTupleValue } from './decoders.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { getEscalationSideLabel, getReportingOutcomeKey, getReportingOutcomeValue, getSecurityPoolSystemState, hasTimestamp, requireSecurityVaultTupleArray } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { readSecurityPoolUniverseId } from './securityPoolActions.js'
import { SECURITY_POOL_QUESTION_OUTCOME_ABI } from './securityPoolAbi.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { loadForkCarriedEscalationDepositsFromParentSnapshot, readEscalationOutcomeState, readForkContinuation } from './reportingCarryState.js'
import { CONTRACT_PAGE_SIZE } from './pagination.js'

const MIGRATION_TIME_LENGTH = 4838400n
const ESCALATION_MIGRATION_ENTITLEMENT_STATUS_ABI = [
	{
		inputs: [
			{ name: 'securityPool', type: 'address' },
			{ name: 'vault', type: 'address' },
		],
		name: 'getEscalationMigrationEntitlementStatus',
		outputs: [
			{ name: 'initialized', type: 'bool' },
			{ name: 'totalCurrentAttoRep', type: 'uint256' },
			{ name: 'materializedByOutcome', type: 'bool[3]' },
		],
		stateMutability: 'view',
		type: 'function',
	},
] as const

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

export async function loadEscalationDeposits(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<EscalationDeposit[]> {
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

async function loadViewerReportingVaultState(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined) {
	if (accountAddress === undefined)
		return {
			viewerPoolHeldVaultRepBackingAttoRep: undefined,
			viewerEscalationMigrationEntitlement: undefined,
			viewerVaultExists: false,
			viewerVaultDisputeStakedAttoRep: undefined,
			viewerVaultRepBackingAttoRep: undefined,
		}
	const [viewerVaultTuple, escalationMigrationEntitlementTuple] = await Promise.all([
		client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'securityVaults',
			address: securityPoolAddress,
			args: [accountAddress],
		}),
		client.readContract({
			abi: ESCALATION_MIGRATION_ENTITLEMENT_STATUS_ABI,
			functionName: 'getEscalationMigrationEntitlementStatus',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress, accountAddress],
		}),
	])
	const [entitlementInitialized, entitlementTotalCurrentRep, materializedByOutcome] = escalationMigrationEntitlementTuple
	const viewerVaultTuples = requireSecurityVaultTupleArray([viewerVaultTuple], 'viewer security vault tuple')
	const [viewerRepBackingUnits, viewerCapacityOwnershipAttoRep, viewerClaimableFeesAttoEth, viewerFeeIndex] = viewerVaultTuples[0] ?? []
	if (typeof viewerRepBackingUnits !== 'bigint' || typeof viewerCapacityOwnershipAttoRep !== 'bigint' || typeof viewerClaimableFeesAttoEth !== 'bigint' || typeof viewerFeeIndex !== 'bigint') throw new Error('Unexpected viewer security vault tuple response')
	const viewerVaultRepBackingAttoRep =
		viewerRepBackingUnits === 0n
			? 0n
			: await client.readContract({
					abi: statoblast_SecurityPool_SecurityPool.abi,
					functionName: 'backingUnitsToAttoRep',
					address: securityPoolAddress,
					args: [viewerRepBackingUnits],
				})
	const escalationGameAddress = await client.readContract({
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		address: securityPoolAddress,
		args: [],
	})
	const viewerVaultDisputeStakedAttoRep = sameAddress(escalationGameAddress, zeroAddress)
		? 0n
		: await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				functionName: 'disputeStakedRepByVaultAttoRep',
				address: escalationGameAddress,
				args: [accountAddress],
			})
	const viewerVaultExists = viewerRepBackingUnits !== 0n || viewerCapacityOwnershipAttoRep !== 0n || viewerClaimableFeesAttoEth !== 0n || viewerFeeIndex !== 0n || viewerVaultDisputeStakedAttoRep !== 0n
	const viewerPoolHeldVaultRepBackingAttoRep = viewerVaultRepBackingAttoRep
	return {
		viewerPoolHeldVaultRepBackingAttoRep,
		viewerEscalationMigrationEntitlement: {
			initialized: entitlementInitialized,
			materializedByOutcome: {
				invalid: materializedByOutcome[0],
				yes: materializedByOutcome[1],
				no: materializedByOutcome[2],
			},
			totalCurrentAttoRep: entitlementTotalCurrentRep,
		},
		viewerVaultExists,
		viewerVaultDisputeStakedAttoRep,
		viewerVaultRepBackingAttoRep,
	}
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
	const [marketDetails, block, escalationGameCode, viewerVaultState, forkThresholdAttoRep] = await Promise.all([
		loadMarketDetails(client, questionId),
		client.getBlock(),
		escalationGameAddress === zeroAddress ? Promise.resolve('0x' as const) : client.getCode({ address: escalationGameAddress }),
		loadViewerReportingVaultState(client, securityPoolAddress, accountAddress),
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
		return {
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
			...viewerVaultState,
		}
	}
	const forkContinuationSnapshot = await readForkContinuation(client, escalationGameAddress)
	const walletReportingStatePromise =
		accountAddress === undefined || forkContinuationSnapshot
			? Promise.resolve({ viewerWalletRepAllowanceAttoRep: undefined, viewerWalletRepBalanceAttoRep: undefined, viewerWalletRepTokenAddress: undefined })
			: (async () => {
					const viewerWalletRepTokenAddress = await client.readContract({
						abi: statoblast_EscalationGame_EscalationGame.abi,
						functionName: 'repToken',
						address: escalationGameAddress,
						args: [],
					})
					const [viewerWalletRepBalanceAttoRep, viewerWalletRepAllowanceAttoRep] = await Promise.all([
						client.readContract({ abi: ABIS.mainnet.erc20, functionName: 'balanceOf', address: viewerWalletRepTokenAddress, args: [accountAddress] }),
						client.readContract({ abi: ABIS.mainnet.erc20, functionName: 'allowance', address: viewerWalletRepTokenAddress, args: [accountAddress, escalationGameAddress] }),
					])
					return { viewerWalletRepAllowanceAttoRep, viewerWalletRepBalanceAttoRep, viewerWalletRepTokenAddress }
				})()
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
		settlementState = block.timestamp <= universeForkTime + MIGRATION_TIME_LENGTH ? 'migration-required' : 'migration-expired'
	}
	return {
		bindingCapital,
		contributionFunding: forkContinuationSnapshot ? 'vault' : 'wallet',
		settlementCollateralAttoEth,
		currentRequiredBond: totalCostAttoRep === 0n ? startBondAttoRep : totalCostAttoRep,
		currentTime: block.timestamp,
		escalationEndTime,
		escalationGameAddress,
		forkThresholdAttoRep,
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
		universeId,
		parentWithdrawalEnabled: settlementState === 'resolved',
		...walletReportingState,
		...viewerVaultState,
	}
}

export async function reportOutcomeInSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amountAttoRep: bigint) {
	const [universeId, escalationGameAddress] = await Promise.all([
		readSecurityPoolUniverseId(client, securityPoolAddress),
		client.readContract({
			address: securityPoolAddress,
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			args: [],
		}),
	])
	const useWalletFunding =
		escalationGameAddress !== zeroAddress &&
		!(await client.readContract({
			address: escalationGameAddress,
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'forkContinuation',
			args: [],
		}))
	const hash = await writeContractAndWait(client, () => ({
		address: useWalletFunding ? escalationGameAddress : securityPoolAddress,
		abi: useWalletFunding ? statoblast_EscalationGame_EscalationGame.abi : statoblast_SecurityPool_SecurityPool.abi,
		functionName: useWalletFunding ? 'depositRepOnOutcome' : 'depositToEscalationGame',
		args: [getReportingOutcomeValue(outcome), amountAttoRep],
	}))
	return {
		action: 'reportOutcome',
		hash,
		outcome,
		securityPoolAddress,
		universeId,
	} satisfies ReportingActionResult
}

export async function approveReportingRep(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amountAttoRep: bigint) {
	const [universeId, escalationGameAddress] = await Promise.all([readSecurityPoolUniverseId(client, securityPoolAddress), client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'escalationGame', args: [] })])
	if (escalationGameAddress === zeroAddress) throw new Error('REP approval is only available after the ordinary escalation game starts.')
	const forkContinuation = await client.readContract({ address: escalationGameAddress, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'forkContinuation', args: [] })
	if (forkContinuation) throw new Error('Fork continuations use vault-funded escalation deposits.')
	const repTokenAddress = await client.readContract({ address: escalationGameAddress, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'repToken', args: [] })
	const hash = await writeContractAndWait(client, () => ({
		address: repTokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [escalationGameAddress, amountAttoRep],
	}))
	return { action: 'approveReportingRep', hash, outcome, securityPoolAddress, universeId } satisfies ReportingActionResult
}

export async function withdrawEscalationFromSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) {
	const universeId = await readSecurityPoolUniverseId(client, securityPoolAddress)
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'withdrawFromEscalationGame',
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
