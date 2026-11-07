import type { OperatorSettings } from '#config/settings'
import { serializePortfolioInstructions, type PortfolioInstruction } from '#config/portfolio-instructions'
import type { PortfolioObservation } from '#monitoring/portfolio-monitor'
import type { RuntimeState } from '#state/operator-state'
import type { Account, Chain, Transport, WalletClient, createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { readPortfolioExecutionSnapshot } from './portfolio-execution-snapshot.ts'
import { buildPortfolioInstructionRequest } from './portfolio-instruction-request.ts'
import { submitCall } from './submit-call.ts'
import { PortfolioOpportunityExpired } from './portfolio-executor.ts'

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

/** Durable, one-shot instructions use the same quorum, simulation and journal as automatic takeovers. */
export async function executePortfolioInstruction(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, instruction: PortfolioInstruction, priceAllowed: (observation: PortfolioObservation) => Promise<boolean>) {
	if (!settings.runtime.execute || state.pendingTransactions.length !== 0 || state.pendingStagedOperations.length !== 0) throw new Error('Pending recovery or dry-run mode blocks portfolio instructions')
	const fingerprint = JSON.stringify(serializePortfolioInstructions([instruction])[0])
	const completed = state.completedPortfolioInstructions !== undefined && Object.hasOwn(state.completedPortfolioInstructions, instruction.id) ? state.completedPortfolioInstructions[instruction.id] : undefined
	if (completed !== undefined) {
		if (completed !== fingerprint) throw new Error('Completed portfolio instruction IDs cannot be reused with different terms')
		return false
	}
	const refresh = async () => {
		const result = await readPortfolioExecutionSnapshot(
			wallet,
			settings,
			pool,
			state.portfolioScopes.map(scope => ({ scope, targets: [] })),
			{ address: instruction.portfolio, universeId: instruction.universeId },
			async context => {
				const { observation } = context
				if (!observation.selected || !observation.approvedUniverse) throw new Error('Instruction portfolio and universe must be selected and approved')
				const prepared = await buildPortfolioInstructionRequest({ ...context, settings }, instruction)
				if (observation.snapshot.owner !== wallet.account.address || observation.walletAttoEth < prepared.request.value + settings.portfolioPolicy.walletReserveAttoEth + settings.strategy.maximumGasCostAttoEth) throw new PortfolioOpportunityExpired('Instruction would consume the wallet gas reserve')
				return prepared
			},
		)
		if (instruction.action === 'auction-bid' && !(await priceAllowed(result.observation))) throw new PortfolioOpportunityExpired('Independent REP pricing does not allow the auction bid')
		return result.details
	}

	const { request, completes } = await refresh()
	const validate = async () => {
		const fresh = await refresh()
		if (fresh.request.to !== request.to || fresh.request.data !== request.data || fresh.request.value !== request.value || fresh.completes !== completes) throw new PortfolioOpportunityExpired('Instruction terms changed before submission')
	}
	let kind: 'migration' | 'deposit' | 'withdrawal' = 'withdrawal'
	if (instruction.action === 'fork-choice' || instruction.action === 'vault-fork-choice') kind = 'migration'
	if (instruction.action === 'auction-bid' || instruction.action === 'vault-deposit') kind = 'deposit'
	await submitCall(wallet, settings, state, pool, { ...request, gas: 'estimate', label: `Portfolio instruction ${instruction.id}: ${instruction.action}`, portfolioInstruction: completes ? { id: instruction.id, fingerprint } : undefined, preSubmit: validate, revalidateSimulationRevert: validate }, kind)
	return true
}
