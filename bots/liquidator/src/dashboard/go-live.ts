import { quorumRpcRow, relayDeliveryRow, renderExecutionMode, signerRow, type ReadinessRow } from '@zoltar/bot-shared/dashboard/readiness'
import type { Configuration, Snapshot } from './api-validation.ts'

const NETWORK_LABELS = { mainnet: 'Ethereum mainnet', sepolia: 'Sepolia' } as const

function networkRow(configuration: Configuration): ReadinessRow {
	const network = configuration.network
	if (network === undefined || configuration.networkConfigured !== true) return { detail: 'Save the chain and RPC endpoints under Connect', label: 'Chain and RPC endpoints', ready: false }
	return { detail: `${NETWORK_LABELS[network.name]} · chain ${network.chainId.toString()}`, label: 'Chain and RPC endpoints', ready: true }
}

/** The canonical factory, WETH, and Zoltar contracts are rechecked before every scan; a completed scan proves they exist. */
function canonicalContractsRow(snapshot: Snapshot): ReadinessRow {
	if (snapshot.deploymentMissingName !== undefined) return { detail: `Missing ${snapshot.deploymentMissingName}${snapshot.deploymentCheckedBlock === undefined ? '' : ` at block ${snapshot.deploymentCheckedBlock}`}`, label: 'Canonical contracts', ready: false }
	if (snapshot.lastScannedBlock === undefined) return { detail: 'Waiting for the first scan', label: 'Canonical contracts', ready: false }
	return { detail: `Verified at block ${snapshot.lastScannedBlock}`, label: 'Canonical contracts', ready: true }
}

/**
 * The prerequisites the liquidator enforces before it signs: the operator file rejects live mode without a signer or
 * the quorum RPCs, the scan loop waits for the canonical contracts, and delivery needs a relay in private mode. Pools,
 * universes, and market evidence only decide what can be liquidated, so they are advisory.
 */
function readinessRows(snapshot: Snapshot, configuration: Configuration): ReadinessRow[] {
	const consensus = snapshot.marketConsensus
	let marketDetail = 'No market sources configured'
	if (consensus !== undefined) marketDetail = consensus.reliable ? 'Reliable' : 'Guarded · unavailable'
	return [
		signerRow(snapshot.wallet, 'Set one under Execution signer'),
		networkRow(configuration),
		quorumRpcRow(configuration.connectivity?.quorumRpcUrls.length ?? 0, configuration.connectivity?.rpcQuorum),
		canonicalContractsRow(snapshot),
		relayDeliveryRow(configuration.submission.mode, configuration.submission.relayUrls.length),
		{ advisory: true, detail: `${snapshot.metrics.approvedUniverseCount.toString()} approved`, label: 'Approved universes', ready: snapshot.metrics.approvedUniverseCount > 0 },
		{ advisory: true, detail: `${snapshot.metrics.selectedPoolCount.toString()} supported · ${snapshot.metrics.eligiblePoolCount.toString()} eligible`, label: 'Supported pools', ready: snapshot.metrics.selectedPoolCount > 0 },
		{ advisory: true, detail: marketDetail, label: 'Market evidence', ready: consensus?.reliable === true },
	]
}

/** Live execution stays locked until every required row holds; a live operator can always return to dry run. */
export function renderGoLive(snapshot: Snapshot, configuration: Configuration) {
	renderExecutionMode(readinessRows(snapshot, configuration), { live: snapshot.execute, queued: false, saved: configuration.runtime.execute })
}
