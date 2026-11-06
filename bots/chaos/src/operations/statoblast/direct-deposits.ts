import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationEvidence, PlanningOptions } from '../types.ts'
import { ONE_TOKEN, allowance, amount, choose, eligible, encodePreflightCall, encodeStep, erc20AllowanceEvidence, erc20WalletDebit, eventTopic, mixSeed, optionAmount, planBase, tokenInventory } from '../planning.ts'
import { erc20Abi, escalationGameAbi } from '@zoltar/bot-shared/contracts/abi'
import { DEPOSIT_ON_OUTCOME_ABI, DEPOSIT_ON_OUTCOME_SIGNATURE, ERC20_TRANSFER_ABI, ERC20_TRANSFER_SIGNATURE, LOCAL_DEPOSIT_APPENDED_ABI, LOCAL_DEPOSIT_APPENDED_SIGNATURE, operationalPools, requiredVaultMetadataAmount, requiredVaultMetadataString } from './planning.ts'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'

function directEscalationApprovalStep(snapshot: EcosystemSnapshot, token: `0x${string}`, game: `0x${string}`, required: bigint, id = 'approve-direct-rep', label = 'Approve REP for direct escalation deposit') {
	return encodeStep({ abi: erc20Abi, args: [game, required], evidence: [erc20AllowanceEvidence(token, snapshot.wallet.address, game, required)], functionName: 'approve', id, label, to: token })
}

function exactPreviousDirectEscalationApproval(snapshot: EcosystemSnapshot, context: OperationContinuationContext, token: `0x${string}`, game: `0x${string}`, required: bigint) {
	const previous = context.previousPlan.steps.find(step => step.id === 'approve-direct-rep')
	if (previous === undefined) return undefined
	const expected = directEscalationApprovalStep(snapshot, token, game, required)
	return previous.to.toLowerCase() === expected.to.toLowerCase() && previous.data === expected.data ? previous : undefined
}

function directEscalationCleanupPlan(snapshot: EcosystemSnapshot, context: OperationContinuationContext, token: `0x${string}`, game: `0x${string}`, required: bigint) {
	const previous = exactPreviousDirectEscalationApproval(snapshot, context, token, game, required)
	if (previous === undefined || !context.confirmedStepIds.includes(previous.id)) return undefined
	return planBase({
		continuationDisposition: 'cleanup-only',
		definitionId: context.previousPlan.definitionId,
		ecosystem: 'statoblast',
		label: 'Clean up direct escalation deposit approval',
		metadata: context.previousPlan.metadata,
		postconditions: ['The confirmed workflow-created REP allowance for the escalation game is zero'],
		risk: 'high',
		snapshot,
		steps: [directEscalationApprovalStep(snapshot, token, game, 0n, 'revoke-direct-rep', 'Revoke workflow-created REP approval for escalation game')],
	})
}

function directEscalationDepositEvidence(snapshot: EcosystemSnapshot, token: `0x${string}`, game: `0x${string}`, outcome: number, acceptedAmountAttoRep: bigint, resultingCumulativeAmountAttoRep: bigint): OperationEvidence[] {
	const depositIndexed = { depositor: snapshot.wallet.address, outcome: outcome.toString() }
	const localIndexed = { depositor: snapshot.wallet.address, outcome: outcome.toString() }
	const decoded = (abi: string, signature: string, indexed: Record<string, string>, field: string, equals: string): OperationEvidence => ({
		abi,
		emitter: game,
		equals,
		field,
		indexed,
		kind: 'decoded-event-field',
		signature,
		topic0: eventTopic(signature),
	})
	return [
		decoded(DEPOSIT_ON_OUTCOME_ABI, DEPOSIT_ON_OUTCOME_SIGNATURE, depositIndexed, 'amountAttoRep', acceptedAmountAttoRep.toString()),
		decoded(DEPOSIT_ON_OUTCOME_ABI, DEPOSIT_ON_OUTCOME_SIGNATURE, depositIndexed, 'cumulativeRepAmountAttoRep', resultingCumulativeAmountAttoRep.toString()),
		decoded(LOCAL_DEPOSIT_APPENDED_ABI, LOCAL_DEPOSIT_APPENDED_SIGNATURE, localIndexed, 'amountAttoRep', acceptedAmountAttoRep.toString()),
		decoded(LOCAL_DEPOSIT_APPENDED_ABI, LOCAL_DEPOSIT_APPENDED_SIGNATURE, localIndexed, 'cumulativeRepAmountAttoRep', resultingCumulativeAmountAttoRep.toString()),
		{
			abi: ERC20_TRANSFER_ABI,
			emitter: token,
			equals: acceptedAmountAttoRep.toString(),
			field: 'value',
			indexed: { from: snapshot.wallet.address, to: game },
			kind: 'decoded-event-field',
			signature: ERC20_TRANSFER_SIGNATURE,
			topic0: eventTopic(ERC20_TRANSFER_SIGNATURE),
		},
	]
}

function directEscalationDepositStep(snapshot: EcosystemSnapshot, token: `0x${string}`, game: `0x${string}`, outcome: number, maximumDepositAttoRep: bigint, acceptedAmountAttoRep: bigint, resultingCumulativeAmountAttoRep: bigint) {
	return encodeStep({
		abi: escalationGameAbi,
		args: [outcome, maximumDepositAttoRep],
		evidence: directEscalationDepositEvidence(snapshot, token, game, outcome, acceptedAmountAttoRep, resultingCumulativeAmountAttoRep),
		functionName: 'depositRepOnOutcome',
		id: 'deposit-wallet-rep',
		label: 'Deposit wallet REP directly into escalation game',
		preflightCalls: [
			encodePreflightCall({
				abi: escalationGameAbi,
				args: [outcome, maximumDepositAttoRep],
				caller: snapshot.wallet.address,
				expectedResult: '0x',
				functionName: 'depositRepOnOutcome',
				label: 'Revalidate exact direct escalation deposit',
				to: game,
			}),
		],
		to: game,
		walletAssetDebits: [erc20WalletDebit(token, acceptedAmountAttoRep, 'rep')],
	})
}

function directEscalationCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	const maximumSpend = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
	const reserve = optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN)
	return operationalPools(snapshot).flatMap(pool => {
		if (pool.escalationGame === zeroAddress) return []
		const inventory = tokenInventory(snapshot, pool.repToken)
		if (inventory === undefined) return []
		return pool.directEscalationDepositQuotes.flatMap((quote, outcome) => {
			const accepted = amount(quote.acceptedAmountAttoRep)
			const maximum = amount(quote.maximumDepositAttoRep)
			const resultingCumulative = amount(quote.resultingCumulativeAmountAttoRep)
			const currentBalance = amount(pool.escalationOutcomeBalancesAttoRep[outcome] ?? '0')
			if (accepted === 0n || maximum !== accepted || maximum > maximumSpend || resultingCumulative !== currentBalance + accepted || resultingCumulative !== amount(pool.escalationNonDecisionThresholdAttoRep) || amount(inventory.balance) < accepted + reserve) return []
			const approvalRequired = allowance(inventory, pool.escalationGame) < accepted
			if (!approvalRequired && !quote.mutationExpectedSuccess) return []
			return [{ accepted, approvalRequired, maximum, outcome, pool, resultingCumulative }]
		})
	})
}

export const directEscalationDeposit: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(directEscalationCandidates(snapshot, options), mixSeed(options.seed, directEscalationDeposit.id))
		if (candidate === undefined) return undefined
		const steps = candidate.approvalRequired ? [directEscalationApprovalStep(snapshot, candidate.pool.repToken, candidate.pool.escalationGame, candidate.accepted)] : []
		steps.push(directEscalationDepositStep(snapshot, candidate.pool.repToken, candidate.pool.escalationGame, candidate.outcome, candidate.maximum, candidate.accepted, candidate.resultingCumulative))
		return planBase({
			definitionId: directEscalationDeposit.id,
			ecosystem: 'statoblast',
			label: directEscalationDeposit.label,
			lastValidBlockNumber: (amount(snapshot.anchor.blockNumber) + 1n).toString(),
			maximumCleanupTransactionCount: candidate.approvalRequired ? 1 : undefined,
			metadata: {
				acceptedAmountAttoRep: candidate.accepted.toString(),
				escalationGame: candidate.pool.escalationGame,
				maximumDepositAttoRep: candidate.maximum.toString(),
				outcome: candidate.outcome,
				pool: candidate.pool.address,
				repToken: candidate.pool.repToken,
				resultingCumulativeAmountAttoRep: candidate.resultingCumulative.toString(),
			},
			postconditions: ['Exact wallet REP is escrowed as a canonical local escalation deposit'],
			risk: 'high',
			snapshot,
			steps,
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const accepted = requiredVaultMetadataAmount(context.previousPlan.metadata, 'acceptedAmountAttoRep')
		const maximum = requiredVaultMetadataAmount(context.previousPlan.metadata, 'maximumDepositAttoRep')
		const resultingCumulative = requiredVaultMetadataAmount(context.previousPlan.metadata, 'resultingCumulativeAmountAttoRep')
		const outcome = context.previousPlan.metadata['outcome']
		const poolAddress = getAddress(requiredVaultMetadataString(context.previousPlan.metadata, 'pool'))
		const repToken = getAddress(requiredVaultMetadataString(context.previousPlan.metadata, 'repToken'))
		const game = getAddress(requiredVaultMetadataString(context.previousPlan.metadata, 'escalationGame'))
		const cleanup = () => directEscalationCleanupPlan(snapshot, context, repToken, game, accepted)
		if (context.continuationDisposition === 'cleanup-only') return cleanup()
		if (typeof outcome !== 'number' || !Number.isInteger(outcome) || outcome < 0 || outcome > 2) return cleanup()
		const pool = operationalPools(snapshot).find(candidate => candidate.address.toLowerCase() === poolAddress.toLowerCase())
		const inventory = tokenInventory(snapshot, repToken)
		const quote = pool?.directEscalationDepositQuotes[outcome]
		const previousApproval = exactPreviousDirectEscalationApproval(snapshot, context, repToken, game, accepted)
		const hasUnexpectedApproval = context.previousPlan.steps.some(step => step.id === 'approve-direct-rep') && previousApproval === undefined
		const previousAction = context.previousPlan.steps.find(step => step.id === 'deposit-wallet-rep')
		const expectedAction = directEscalationDepositStep(snapshot, repToken, game, outcome, maximum, accepted, resultingCumulative)
		const actionMatches = previousAction !== undefined && JSON.stringify(previousAction) === JSON.stringify(expectedAction)
		const approvalConfirmed = previousApproval !== undefined && context.confirmedStepIds.includes(previousApproval.id)
		const sufficientAllowance = inventory !== undefined && allowance(inventory, game) >= accepted
		const simulationRequired = previousApproval === undefined || approvalConfirmed || sufficientAllowance
		const approvalStateMatches = inventory !== undefined && (previousApproval === undefined ? allowance(inventory, game) >= accepted : !approvalConfirmed || allowance(inventory, game) >= accepted)
		const safe =
			options.allowHighRisk === true &&
			!hasUnexpectedApproval &&
			actionMatches &&
			pool !== undefined &&
			game !== zeroAddress &&
			pool.repToken.toLowerCase() === repToken.toLowerCase() &&
			pool.escalationGame.toLowerCase() === game.toLowerCase() &&
			quote !== undefined &&
			amount(quote.acceptedAmountAttoRep) === accepted &&
			amount(quote.maximumDepositAttoRep) === maximum &&
			amount(quote.resultingCumulativeAmountAttoRep) === resultingCumulative &&
			resultingCumulative === amount(pool.escalationOutcomeBalancesAttoRep[outcome] ?? '0') + accepted &&
			resultingCumulative === amount(pool.escalationNonDecisionThresholdAttoRep) &&
			(!simulationRequired || quote.mutationExpectedSuccess) &&
			accepted > 0n &&
			maximum === accepted &&
			accepted <= optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) &&
			maximum <= optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) &&
			inventory !== undefined &&
			amount(inventory.balance) >= accepted + optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN) &&
			approvalStateMatches
		if (!safe) return cleanup()
		const steps = previousApproval !== undefined && !approvalConfirmed && !sufficientAllowance ? [directEscalationApprovalStep(snapshot, repToken, game, accepted)] : []
		steps.push(expectedAction)
		return planBase({
			definitionId: directEscalationDeposit.id,
			ecosystem: 'statoblast',
			label: directEscalationDeposit.label,
			lastValidBlockNumber: (amount(snapshot.anchor.blockNumber) + 1n).toString(),
			maximumCleanupTransactionCount: previousApproval === undefined ? undefined : 1,
			metadata: context.previousPlan.metadata,
			postconditions: ['Exact wallet REP is escrowed as a canonical local escalation deposit'],
			risk: 'high',
			snapshot,
			steps,
		})
	},
	classification: 'selectable',
	contract: 'EscalationGame',
	description: 'Deposits exactly one full start bond from a wallet when its anchored quote fills the canonical non-decision threshold.',
	discoveryInputs: ['canonical escalation game and non-decision threshold', 'anchored direct deposit preview and mutation simulation', 'wallet REP balance and dynamic game allowance'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		return eligible(options.allowHighRisk === true ? undefined : 'High-risk operations are disabled', directEscalationCandidates(snapshot, options).length > 0 ? undefined : 'No wallet direct deposit has an affordable full-start-bond quote that exactly fills the threshold and a safe approval or mutation path')
	},
	id: 'statoblast.escalation.deposit-wallet-rep',
	label: 'Deposit wallet REP to escalation game',
	method: 'depositRepOnOutcome',
	risk: 'high',
}
