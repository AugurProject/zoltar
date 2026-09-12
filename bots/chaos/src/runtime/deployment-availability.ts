import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { DeploymentSettings, OperatorSettings } from '../config/settings.ts'
import type { ChaosReadClient } from '../monitoring/discovery-client.ts'
import type { EcosystemSnapshot } from '../operations/types.ts'
import type { RuntimeState } from '../state/operator-state.ts'
import { canonicalAnchor, chaosReadClients, createChaosReadPool, unavailableOperationCatalog } from './canonical-scan.ts'

async function missingDeploymentRoots(client: Pick<ChaosReadClient, 'getCode'>, deployment: DeploymentSettings, blockNumber: bigint) {
	const roots = [
		{ name: 'Zoltar', address: deployment.zoltar },
		{ name: 'Question data', address: deployment.questionData },
		{ name: 'Security pool factory', address: deployment.securityPoolFactory },
		{ name: 'Security pool forker', address: deployment.securityPoolForker },
		{ name: 'OpenOracle', address: deployment.openOracle },
		{ name: 'WETH', address: deployment.weth },
		{ name: 'Trading factory', address: deployment.tradingFactory },
		{ name: 'Trading router', address: deployment.tradingRouter },
	]
	const code = await Promise.all(roots.map(root => client.getCode({ address: root.address, blockNumber })))
	return roots.filter((_, index) => code[index] === undefined || code[index] === '0x')
}

export async function checkDeploymentAvailability(settings: OperatorSettings, pool: ReturnType<typeof createChaosReadPool>) {
	const anchor = await canonicalAnchor(settings, pool)
	const missing = await settledQuorumValue(
		'ecosystem deployment availability',
		chaosReadClients(settings, pool).map(async ({ client, endpoint }) => ({ endpoint, value: await missingDeploymentRoots(client, settings.deployment, anchor.blockNumber) })),
		settings.connectivity?.rpcQuorum,
	)
	const blocking = missing.some(root => root.address !== settings.deployment.tradingFactory && root.address !== settings.deployment.tradingRouter)
	const notice = deploymentNotice(
		settings.network.chainId,
		anchor.blockNumber.toString(),
		missing.map(root => root.name),
		blocking,
	)
	return { blockNumber: anchor.blockNumber, checkedAt: new Date().toISOString(), notice, blocking }
}

export function recordUnavailableDeploymentScan(state: RuntimeState, notice: string, check: { blockNumber: bigint; checkedAt: string }) {
	state.lastDeploymentCheckedBlock = check.blockNumber
	state.lastDeploymentCheckAt = check.checkedAt
	state.deploymentNotice = notice
	state.error = undefined
	state.evaluations = unavailableOperationCatalog(notice)
}

function deploymentNotice(chainId: number, block: string, missing: string[], blocking: boolean) {
	if (missing.length === 0) return undefined
	const effect = blocking ? 'Chaos operations are unavailable until these contracts are deployed.' : 'Operations that need these contracts are unavailable; other eligible operations can continue.'
	return `Waiting for deployments on chain ${chainId.toString()} at block ${block}: ${missing.join(', ')}. ${effect} Availability is checked automatically.`
}

export function tradingDeploymentNotice(snapshot: EcosystemSnapshot) {
	const missing = [snapshot.tradingDeployment?.factory === false ? 'Trading factory' : undefined, snapshot.tradingDeployment?.router === false ? 'Trading router' : undefined].filter((name): name is string => name !== undefined)
	return deploymentNotice(snapshot.chainId, snapshot.anchor.blockNumber, missing, false)
}
