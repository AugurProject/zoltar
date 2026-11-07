import { securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import type { EcosystemSnapshot, OperationDefinition, PlanningOptions } from '../types.ts'
import { ONE_TOKEN, allowance, amount, choose, eligible, encodePreflightCall, encodeStep, erc20WalletDebit, mixSeed, optionAmount, planBase, tokenInventory } from '../planning.ts'
import { approvePool, operationalPools, poolApprovalPrepared, poolCleanupPlan, requiredVaultMetadataAmount, requiredVaultMetadataString } from './planning.ts'

function candidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	if (options.allowHighRisk !== true) return []
	return operationalPools(snapshot).flatMap(pool => {
		const question = snapshot.questions.find(question => question.id === pool.questionId)
		const maximum = amount(pool.initialEscalationGameDepositAttoRep)
		const token = tokenInventory(snapshot, pool.repToken)
		if (
			question === undefined ||
			amount(question.endTime) > amount(snapshot.anchor.timestamp) ||
			pool.escalationGame !== zeroAddress ||
			maximum === 0n ||
			maximum > optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) ||
			token === undefined ||
			amount(token.balance) < maximum + optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN)
		)
			return []
		return [0, 1, 2].flatMap(outcome => (allowance(token, pool.address) < maximum || amount(pool.safeEscalationDepositMaximumsAttoRep[outcome] ?? '0') === maximum ? [{ pool, maximum, outcome }] : []))
	})
}

function depositStep(snapshot: EcosystemSnapshot, pool: `0x${string}`, repToken: `0x${string}`, outcome: number, maximum: bigint) {
	return encodeStep({
		abi: securityPoolAbi,
		args: [outcome, maximum],
		functionName: 'depositWalletRepToEscalationGame',
		id: 'start-wallet-report',
		label: 'Start reporting with wallet REP',
		to: pool,
		walletAssetDebits: [erc20WalletDebit(repToken, maximum, 'rep')],
		preflightCalls: [encodePreflightCall({ abi: securityPoolAbi, args: [outcome, maximum], caller: snapshot.wallet.address, expectedResult: '0x', functionName: 'depositWalletRepToEscalationGame', label: 'Revalidate exact initial wallet report', to: pool })],
	})
}

export const escalationDeposit: OperationDefinition = {
	id: 'statoblast.escalation.deposit',
	label: 'Start wallet-funded reporting',
	method: 'depositWalletRepToEscalationGame',
	contract: 'SecurityPool',
	classification: 'selectable',
	ecosystem: 'statoblast',
	risk: 'high',
	description: 'Creates a question’s escalation game and deposits its initial report bond from wallet REP.',
	discoveryInputs: ['ended questions without a game', 'initial report bond', 'wallet REP and approval'],
	evaluate: (snapshot, options) => eligible(candidates(snapshot, options).length > 0 ? undefined : 'No ended question has an affordable initial wallet report'),
	buildPlan(snapshot, options) {
		const candidate = choose(candidates(snapshot, options), mixSeed(options.seed, escalationDeposit.id))
		if (candidate === undefined) return undefined
		const { pool, maximum, outcome } = candidate
		const approvals = approvePool(snapshot, pool, maximum)
		return planBase({
			definitionId: escalationDeposit.id,
			ecosystem: 'statoblast',
			label: escalationDeposit.label,
			metadata: { pool: pool.address, repToken: pool.repToken, maximumDepositAttoRep: maximum.toString(), outcome },
			maximumCleanupTransactionCount: approvals.length > 0 ? 1 : undefined,
			postconditions: ['A wallet-funded local reporter deposit exists'],
			risk: 'high',
			snapshot,
			steps: [...approvals, depositStep(snapshot, pool.address, pool.repToken, outcome, maximum)],
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const poolAddress = getAddress(requiredVaultMetadataString(context.previousPlan.metadata, 'pool'))
		const repToken = getAddress(requiredVaultMetadataString(context.previousPlan.metadata, 'repToken'))
		const maximum = requiredVaultMetadataAmount(context.previousPlan.metadata, 'maximumDepositAttoRep')
		const outcome = context.previousPlan.metadata['outcome']
		const cleanup = () => poolCleanupPlan(snapshot, context, repToken, poolAddress, maximum)
		if (context.continuationDisposition === 'cleanup-only' || typeof outcome !== 'number' || !Number.isInteger(outcome) || outcome < 0 || outcome > 2 || maximum === 0n) return cleanup()
		const candidate = candidates(snapshot, options).find(candidate => candidate.pool.address.toLowerCase() === poolAddress.toLowerCase() && candidate.pool.repToken.toLowerCase() === repToken.toLowerCase() && candidate.maximum === maximum && candidate.outcome === outcome)
		const step = depositStep(snapshot, poolAddress, repToken, outcome, maximum)
		if (candidate === undefined || !poolApprovalPrepared(snapshot, context, repToken, poolAddress, maximum) || JSON.stringify(context.previousPlan.steps.find(step => step.id === 'start-wallet-report')) !== JSON.stringify(step)) return cleanup()
		const approvals = approvePool(snapshot, candidate.pool, maximum)
		return planBase({
			definitionId: escalationDeposit.id,
			ecosystem: 'statoblast',
			label: escalationDeposit.label,
			metadata: context.previousPlan.metadata,
			maximumCleanupTransactionCount: context.previousPlan.maximumCleanupTransactionCount,
			postconditions: ['A wallet-funded local reporter deposit exists'],
			risk: 'high',
			snapshot,
			steps: [...approvals, step],
		})
	},
}
