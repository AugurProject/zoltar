import type { Address } from '@zoltar/bot-shared/ethereum'
import type { EcosystemSnapshot, EvaluatedOperation } from '../operations/types.ts'
import type { DurableState } from './operator-state.ts'

export type WalletBalanceState = {
	eth: string
	rep: readonly { balance: string; symbol: string; token: Address; universeId: string }[]
	weth: string
}

export type RuntimeTopologySummary = {
	anchor: { blockNumber: bigint; timestamp: bigint }
	auctions: { address: string; bidCount: number; endTime: string; finalized: boolean; pool: string; startTime: string }[]
	complete: boolean
	pairs: { address: string; feeBps: number; pool: string; status: number; universeId: string }[]
	pools: {
		address: string
		awaitingForkContinuation: boolean
		coordinator: string
		questionId: string
		systemState: number
		universeId: string
		/** Total canonical registry entries, independent of how many vault states this scan inspected. */
		vaultCount: number
	}[]
	reports: { currentReporter: string; flags: number; reportId: string; settlementTime: string; token1: string; token2: string }[]
	universes: { forkQuestionId: string; forkTime: string; id: string; knownChildOutcomeCount: number; parentUniverseId?: string | undefined; repToken: string }[]
}

export type RuntimeState = DurableState & {
	deploymentNotice?: string | undefined
	lastDeploymentCheckedBlock?: bigint | undefined
	lastDeploymentCheckAt?: string | undefined
	error: string | undefined
	evaluations: EvaluatedOperation[]
	inventory: WalletBalanceState
	/** Address whose inventory completed successfully in this process; never restored. */
	inventoryAddress: Address | undefined
	lastScanAt: string | undefined
	lastScannedBlock: bigint | undefined
	paused: boolean
	rpcEndpointHealth: readonly unknown[]
	scanning: boolean
	startedAt: string
	status: 'connectivity-degraded' | 'dry-run' | 'error' | 'paused' | 'running' | 'starting'
	topology: RuntimeTopologySummary | undefined
	wallet: Address | undefined
	warnings: string[]
}

export function walletInventory(snapshot: EcosystemSnapshot): WalletBalanceState {
	const tokenByAddress = new Map(snapshot.wallet.tokens.map(token => [token.address.toLowerCase(), token]))
	const weth = tokenByAddress.get(snapshot.deployments.weth.toLowerCase())
	return {
		eth: snapshot.wallet.ethBalanceAttoEth,
		rep: snapshot.universes.map(universe => {
			const token = tokenByAddress.get(universe.repToken.toLowerCase())
			return {
				balance: token?.balance ?? '0',
				symbol: token?.symbol ?? 'REP',
				token: universe.repToken,
				universeId: universe.id,
			}
		}),
		weth: weth?.balance ?? '0',
	}
}
