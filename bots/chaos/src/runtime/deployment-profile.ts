import type { Address, Hash } from '@zoltar/bot-shared/ethereum'
import { requestTransport } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import type { OperatorSettings } from '../config/settings.ts'
import { resetRuntimeStateForProfile, type RuntimeState } from '../state/operator-state.ts'
import type { RetirementCompletionEvidence } from '../state/retirement.ts'
import { chaosReadClients, chaosReadEndpoints, createChaosReadPool } from './canonical-scan.ts'

function isPristineBootstrapState(state: RuntimeState) {
	const schedulerIsPristine = (state.scheduler.status === 'idle' || state.scheduler.status === 'paused') && state.scheduler.lastDelaySeconds === undefined && state.scheduler.lastRunAt === undefined && state.scheduler.nextRunAt === undefined && state.scheduler.selectedOperationId === undefined
	return (
		state.signerAddress === undefined &&
		state.activities.length === 0 &&
		state.lifecyclePresenceBlocker === undefined &&
		state.obligationTombstones.length === 0 &&
		state.obligations.length === 0 &&
		state.pendingTransactions.length === 0 &&
		state.protocolIndex === undefined &&
		state.retirement.status === 'inactive' &&
		state.retirement.positions.length === 0 &&
		!state.safetyPaused &&
		schedulerIsPristine &&
		state.workflows.length === 0
	)
}

type BoundRetirementCompletionEvidence = RetirementCompletionEvidence & { profileId: string; signerAddress: Address }

function finalizedBlock(value: unknown, endpoint: string) {
	if (typeof value !== 'object' || value === null || !('hash' in value) || !('number' in value)) throw new Error(`RPC ${endpoint} returned an invalid finalized block`)
	const hash = Reflect.get(value, 'hash')
	const number = Reflect.get(value, 'number')
	if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash) || typeof number !== 'string' || !/^0x[0-9a-fA-F]+$/.test(number)) throw new Error(`RPC ${endpoint} returned an invalid finalized block identity`)
	return { hash: hash as Hash, number: BigInt(number) }
}

function boundCompletionEvidence(state: RuntimeState, wallet: Address | undefined): BoundRetirementCompletionEvidence {
	const evidence = state.retirement.completionEvidence
	if (evidence?.profileId === undefined || evidence.signerAddress === undefined) throw new Error('Retirement completion evidence is not bound to its deployment profile and signer')
	if (evidence.profileId !== state.profileId) throw new Error('Retirement completion evidence does not match its deployment profile')
	if (state.signerAddress === undefined || evidence.signerAddress.toLowerCase() !== state.signerAddress.toLowerCase()) throw new Error('Retirement completion evidence does not match the durable signer')
	if (wallet === undefined || evidence.signerAddress.toLowerCase() !== wallet.toLowerCase()) throw new Error('Retirement completion evidence does not match the configured signer')
	return { ...evidence, profileId: evidence.profileId, signerAddress: evidence.signerAddress }
}

export async function verifyRetirementCompletionFinality(settings: OperatorSettings, evidence: BoundRetirementCompletionEvidence) {
	if (settings.connectivity === undefined) throw new Error('Retirement completion cannot authorize deployment replacement without configured RPC connectivity')
	const rpcUrls = chaosReadEndpoints(settings)
	if (new Set(rpcUrls.map(rpcUrl => new URL(rpcUrl).origin)).size < 2) throw new Error('Retirement completion requires at least two independent RPC readers')
	const pool = createChaosReadPool(settings)
	const observations = chaosReadClients(settings, pool)
	const finalized = await confirmCanonicalReceiptFinality(
		observations.map((observation, index) => ({
			getBlock: async ({ blockNumber }: { blockNumber: bigint }) => observation.client.getBlock({ blockNumber }),
			getBlockNumber: async () => observation.client.getBlockNumber(),
			getFinalizedBlock: async () => {
				const chainId = await observation.client.getChainId()
				if (chainId !== settings.network.chainId) throw new Error(`RPC ${observation.endpoint} returned chain ID ${chainId.toString()}, expected ${settings.network.chainId.toString()}`)
				const rpcUrl = rpcUrls[index]
				if (rpcUrl === undefined) throw new Error(`RPC ${observation.endpoint} has no configured transport`)
				return finalizedBlock(await requestTransport<unknown>(pool.transportFor(rpcUrl), { method: 'eth_getBlockByNumber', params: ['finalized', false] }), observation.endpoint)
			},
		})),
		observations.map(observation => observation.endpoint),
		'retirement completion',
		{ blockHash: evidence.blockHash, blockNumber: BigInt(evidence.blockNumber) },
		{ blockTag: 'finalized' },
		undefined,
		2,
	)
	if (!finalized) throw new Error('Retirement completion block is not finalized')
}

export async function resetPristineStateForDeploymentProfile(state: RuntimeState, expectedProfileId: string, paused: boolean, wallet: Address | undefined, stateFile: string, verifyCompletionEvidence: (evidence: BoundRetirementCompletionEvidence) => Promise<void>) {
	if (state.profileId === expectedProfileId) return false
	if (!isPristineBootstrapState(state)) {
		const evidence = state.retirement.completionEvidence
		const override = state.retirement.profileReplacementOverride
		const residualOverrideMatches =
			state.retirement.status === 'drained-with-residuals' &&
			evidence !== undefined &&
			override !== undefined &&
			state.retirement.recipient !== undefined &&
			override.sourceProfileId === state.profileId &&
			override.targetProfileId === expectedProfileId &&
			override.recipient.toLowerCase() === state.retirement.recipient.toLowerCase() &&
			override.completionBlockHash.toLowerCase() === evidence.blockHash.toLowerCase() &&
			override.completionBlockNumber === evidence.blockNumber
		const retirementAllowsReplacement = state.retirement.status === 'drained' || residualOverrideMatches
		if (!retirementAllowsReplacement) throw new Error(`Durable state ${stateFile} contains signer, workflow, obligation, recovery, or audit history for deployment profile ${state.profileId}; drain it first or configure a distinct state file for the new deployment profile ${expectedProfileId}`)
		await verifyCompletionEvidence(boundCompletionEvidence(state, wallet))
	}
	resetRuntimeStateForProfile(state, expectedProfileId, paused, wallet)
	return true
}
