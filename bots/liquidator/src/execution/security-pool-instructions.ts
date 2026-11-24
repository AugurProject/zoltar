import type { OperatorSettings } from '#config/settings'
import { serializeSecurityPoolInstructions, type SecurityPoolInstruction } from '#config/security-pool-instructions'
import type { SecurityPoolObservation } from '#monitoring/security-pool-monitor'
import type { RuntimeState } from '#state/operator-state'
import type { Account, Chain, Transport, WalletClient, createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { readSecurityPoolExecutionSnapshot } from './security-pool-execution-snapshot.ts'
import { buildSecurityPoolInstructionRequest } from './security-pool-instruction-request.ts'
import { submitCall } from './submit-call.ts'
import { SecurityPoolOpportunityExpired } from './security-pool-executor.ts'

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

/** Durable, one-shot instructions use the same quorum, simulation and journal as automatic takeovers. */
/** The journal classification of each instruction by its effect on the operator's funds. */
const INSTRUCTION_KINDS: Record<SecurityPoolInstruction['action'], RuntimeState['pendingTransactions'][number]['kind']> = {
	'auction-activate': 'withdrawal',
	'auction-bid': 'deposit',
	'auction-refund': 'withdrawal',
	'fork-choice': 'migration',
	'vault-deposit': 'deposit',
	'vault-earnings': 'fees',
	'vault-fork-choice': 'migration',
	'vault-health': 'configuration',
	'vault-retire': 'withdrawal',
	'vault-withdraw': 'withdrawal',
}

/** @internal Tests verify each instruction's journal classification. */
export function securityPoolInstructionKind(action: SecurityPoolInstruction['action']) {
	return INSTRUCTION_KINDS[action]
}

export async function executeSecurityPoolInstruction(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, instruction: SecurityPoolInstruction, priceAllowed: (observation: SecurityPoolObservation) => Promise<boolean>) {
	if (!settings.runtime.execute || state.pendingTransactions.length !== 0) throw new Error('Pending recovery or dry-run mode blocks security pool instructions')
	const fingerprint = JSON.stringify(serializeSecurityPoolInstructions([instruction])[0])
	const completed = state.completedSecurityPoolInstructions !== undefined && Object.hasOwn(state.completedSecurityPoolInstructions, instruction.id) ? state.completedSecurityPoolInstructions[instruction.id] : undefined
	if (completed !== undefined) {
		if (completed !== fingerprint) throw new Error('Completed security pool instruction IDs cannot be reused with different terms')
		return false
	}
	const refresh = async () => {
		const result = await readSecurityPoolExecutionSnapshot(
			wallet,
			settings,
			pool,
			state.securityPoolScopes.map(scope => ({ scope, targets: [] })),
			{ address: instruction.securityPool, universeId: instruction.universeId },
			async context => {
				const { observation } = context
				if (!observation.selected || !observation.approvedUniverse) throw new Error('Instruction security pool and universe must be selected and approved')
				const prepared = await buildSecurityPoolInstructionRequest({ ...context, settings }, instruction)
				if (observation.snapshot.owner !== wallet.account.address || observation.walletAttoEth < prepared.request.value + settings.securityPoolPolicy.walletReserveAttoEth + settings.strategy.maximumGasCostAttoEth) throw new SecurityPoolOpportunityExpired('Instruction would consume the wallet gas reserve')
				return prepared
			},
		)
		if (instruction.action === 'auction-bid' && !(await priceAllowed(result.observation))) throw new SecurityPoolOpportunityExpired('Independent REP pricing does not allow the auction bid')
		return result.details
	}

	const { request, completes } = await refresh()
	const validate = async () => {
		const fresh = await refresh()
		if (fresh.request.to !== request.to || fresh.request.data !== request.data || fresh.request.value !== request.value || fresh.completes !== completes) throw new SecurityPoolOpportunityExpired('Instruction terms changed before submission')
	}
	const kind = securityPoolInstructionKind(instruction.action)
	await submitCall(
		wallet,
		settings,
		state,
		pool,
		{
			...request,
			gas: 'estimate',
			label: `Security pool instruction ${instruction.id}: ${instruction.action}`,
			securityPoolInstruction: completes ? { id: instruction.id, fingerprint } : undefined,
			preSubmit: validate,
			revalidateSimulationRevert: validate,
			gasBudgetExceeded: () => {
				throw new SecurityPoolOpportunityExpired('Estimated instruction gas exceeds strategy.maximumGasCostEth')
			},
		},
		kind,
	)
	return true
}
