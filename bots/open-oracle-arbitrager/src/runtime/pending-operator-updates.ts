import type { Address, Hex } from '@zoltar/bot-shared/ethereum'
import type { CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import type { QuorumConnectivitySettings } from '@zoltar/bot-shared/monitoring/quorum-connectivity'
import type { Configuration } from '#config/configuration'
import type { DeploymentSettings } from '#config/deployment-settings'
import type { PersistedOperatorSettings } from '#config/settings-store'
import type { RiskLimits } from '#core/safety-controls'
import type { SubmissionSettings } from '#execution/transaction-submission'
import type { MutableStrategy } from '#state/operator-state'
import type { MutableSettlement } from '#state/settlement-store'
import type { ExclusiveProcessLock } from '#state/position-store'

export type PendingOperatorUpdates = {
	centralizedMarkets: CentralizedMarketSettings | undefined
	/** Applied at the scan boundary to the primary and public RPCs, the quorum readers, and the agreement requirement. */
	connectivity: QuorumConnectivitySettings | undefined
	deployment: DeploymentSettings | undefined
	execute: boolean | undefined
	logLookbackBlocks: bigint | undefined
	maxHedgeSlippageBps: bigint | undefined
	network: Configuration['network'] | undefined
	operatorSettings: PersistedOperatorSettings | undefined
	paused: boolean | undefined
	profileSwitch: boolean
	privateKey: Hex | undefined
	persistedPrivateKey: Hex | undefined
	persistedTokenAddresses: Address[] | undefined
	pollMilliseconds: number | undefined
	riskLimits: RiskLimits | undefined
	settlement: MutableSettlement | undefined
	signerLock: ExclusiveProcessLock | undefined
	signerUpdate: boolean
	strategy: MutableStrategy | undefined
	submission: SubmissionSettings | undefined
	tokenAddresses: Address[] | undefined
}

/** Pending updates with nothing queued: every optional update is absent and no profile switch or signer update is pending. */
export function emptyPendingOperatorUpdates(): PendingOperatorUpdates {
	return {
		centralizedMarkets: undefined,
		connectivity: undefined,
		deployment: undefined,
		execute: undefined,
		logLookbackBlocks: undefined,
		maxHedgeSlippageBps: undefined,
		network: undefined,
		operatorSettings: undefined,
		paused: undefined,
		profileSwitch: false,
		privateKey: undefined,
		persistedPrivateKey: undefined,
		persistedTokenAddresses: undefined,
		pollMilliseconds: undefined,
		riskLimits: undefined,
		settlement: undefined,
		signerLock: undefined,
		signerUpdate: false,
		strategy: undefined,
		submission: undefined,
		tokenAddresses: undefined,
	}
}
