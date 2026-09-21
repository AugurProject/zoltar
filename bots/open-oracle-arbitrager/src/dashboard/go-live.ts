import { requiredDeploymentRoles, type DeploymentRole } from '#config/deployment-roles'
import type { PublicOperatorSnapshot } from '#state/operator-state'
import { renderExecutionMode, type ReadinessRow } from '@zoltar/bot-shared/dashboard/readiness'
import type { DashboardDeployment } from './api-validation.ts'
import { shorten } from './dom.js'

/** The parts of the loaded configuration the readiness checklist needs beside the live snapshot. */
export type GoLiveConfiguration = {
	deployment: DashboardDeployment
	execute: boolean
	relayUrls: readonly string[]
	rpcQuorum: 1 | 2
	submissionMode: 'private' | 'public'
}

function executorRow(snapshot: PublicOperatorSnapshot): ReadinessRow {
	const inspected = snapshot.canonicalDeployments
	if (inspected === undefined) return { detail: 'Waiting for the first scan', label: 'Executor', ready: false }
	if (inspected.executorDeployed) return { detail: snapshot.executor === undefined ? 'Deployed' : shorten(snapshot.executor), label: 'Executor', ready: true }
	return { detail: 'Deploy it under Venues and executor', label: 'Executor', ready: false }
}

/** Display names for the deployment roles the bot inspects. */
const contractRoleNames: Record<DeploymentRole, string> = {
	'open-oracle': 'OpenOracle',
	'security-pool-factory': 'security-pool factory',
	'uniswap-factory': 'Uniswap V3 factory',
	'uniswap-quoter': 'Uniswap V3 quoter',
	'uniswap-router': 'Uniswap V3 router',
	'uniswap-v2-router': 'Uniswap V2 router',
	'uniswap-v4-pool-manager': 'Uniswap V4 pool manager',
	'uniswap-v4-quoter': 'Uniswap V4 quoter',
	weth: 'WETH',
}

/**
 * Readiness follows the saved venues, not the running ones: a venue saved since the last scan adds contracts the scan has
 * not inspected yet, and a venue removed since then no longer matters.
 */
function canonicalContractsRow(snapshot: PublicOperatorSnapshot, deployment: DashboardDeployment): ReadinessRow {
	const inspected = snapshot.canonicalDeployments
	if (inspected === undefined) return { detail: 'Waiting for the first scan', label: 'Canonical contracts', ready: false }
	const required = requiredDeploymentRoles({ v2: deployment.uniswapV2Enabled && snapshot.network === 'mainnet', v3: deployment.uniswapV3Enabled, v4: deployment.uniswapV4Enabled })
	const contracts = required.map(role => inspected.contracts.find(contract => contract.role === role))
	if (contracts.some(contract => contract === undefined)) return { detail: 'Waiting for the next scan', label: 'Canonical contracts', ready: false }
	const missing = contracts.flatMap(contract => (contract === undefined || contract.deployed ? [] : [contractRoleNames[contract.role]]))
	if (missing.length === 0) return { detail: `${required.length.toString()} verified`, label: 'Canonical contracts', ready: true }
	return { detail: `Missing ${missing.join(', ')}`, label: 'Canonical contracts', ready: false }
}

function readinessRows(snapshot: PublicOperatorSnapshot, configuration: GoLiveConfiguration): ReadinessRow[] {
	const signer = snapshot.queuedWallet === null ? undefined : (snapshot.queuedWallet ?? snapshot.wallet)
	const requiredQuorumRpcs = configuration.rpcQuorum === 2 ? 2 : 0
	const quorumRpcs = configuration.deployment.quorumRpcUrls.length
	const venueEnabled = configuration.deployment.uniswapV3Enabled || configuration.deployment.uniswapV4Enabled || (configuration.deployment.uniswapV2Enabled && snapshot.network === 'mainnet')
	const relays = configuration.relayUrls.length
	const coordinators = snapshot.coordinatorAddresses.length
	return [
		{ detail: signer === undefined ? 'Set one under Execution wallet' : shorten(signer), label: 'Execution signer', ready: signer !== undefined },
		{ detail: `${quorumRpcs.toString()} configured · ${requiredQuorumRpcs.toString()} required`, label: 'Independent quorum RPCs', ready: quorumRpcs >= requiredQuorumRpcs },
		{ detail: venueEnabled ? 'Enabled' : 'Enable a Uniswap version under Venues and executor', label: 'Trading venue', ready: venueEnabled },
		executorRow(snapshot),
		canonicalContractsRow(snapshot, configuration.deployment),
		{ detail: configuration.submissionMode === 'private' ? `Private · ${relays.toString()} relay${relays === 1 ? '' : 's'}` : 'Public mempool', label: 'Delivery', ready: configuration.submissionMode === 'public' || relays > 0 },
		{ advisory: true, detail: coordinators === 0 ? 'None discovered' : `${coordinators.toString()} discovered`, label: 'Pool coordinators', ready: coordinators > 0 },
	]
}

/**
 * Live execution is gated on the same prerequisites the bot enforces when it is armed, so the switch cannot be flipped on
 * until every row is satisfied; switching a live operator back to dry run is always allowed.
 */
export function renderGoLive(snapshot: PublicOperatorSnapshot, configuration: GoLiveConfiguration) {
	// The snapshot keeps reporting live until the boundary, so the saved mode decides whether a queued change arms or disarms.
	renderExecutionMode(readinessRows(snapshot, configuration), { live: snapshot.execute, queued: snapshot.queuedSettings.includes('execution'), saved: configuration.execute })
}
