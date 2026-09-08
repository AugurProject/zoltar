import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { DeploymentSettings, OperatorSettings } from '../config/settings.ts'
import type { ChaosReadClient } from '../monitoring/discovery.ts'
import type { RuntimeState } from '../state/operator-state.ts'
import { canonicalAnchor, chaosReadClients, createChaosReadPool, unavailableOperationCatalog } from './canonical-scan.ts'

async function missingDeploymentRoots(client: Pick<ChaosReadClient, 'getCode'>, deployment: DeploymentSettings, blockNumber: bigint, allowMissingTradingDeployment: boolean) {
	const roots = [
		{ name: 'Zoltar', address: deployment.zoltar },
		{ name: 'Question data', address: deployment.questionData },
		{ name: 'Security pool factory', address: deployment.securityPoolFactory },
		{ name: 'Security pool forker', address: deployment.securityPoolForker },
		{ name: 'OpenOracle', address: deployment.openOracle },
		{ name: 'WETH', address: deployment.weth },
		...(allowMissingTradingDeployment
			? []
			: [
					{ name: 'Trading factory', address: deployment.tradingFactory },
					{ name: 'Trading router', address: deployment.tradingRouter },
				]),
	]
	const code = await Promise.all(roots.map(root => client.getCode({ address: root.address, blockNumber })))
	return roots.filter((_, index) => code[index] === undefined || code[index] === '0x')
}

export async function checkDeploymentAvailability(settings: OperatorSettings, pool: ReturnType<typeof createChaosReadPool>) {
	const anchor = await canonicalAnchor(settings, pool)
	const missing = await settledQuorumValue(
		'ecosystem deployment availability',
		chaosReadClients(settings, pool).map(async ({ client, endpoint }) => ({ endpoint, value: await missingDeploymentRoots(client, settings.deployment, anchor.blockNumber, settings.strategy.initializeGenesisUniverse) })),
		settings.connectivity?.rpcQuorum,
	)
	const notice =
		missing.length === 0 ? undefined : `Waiting for deployments on chain ${settings.network.chainId.toString()} at block ${anchor.blockNumber.toString()}: ${missing.map(root => root.name).join(', ')}. Chaos operations are unavailable until these contracts are deployed. Availability is checked automatically.`
	return { blockNumber: anchor.blockNumber, checkedAt: new Date().toISOString(), notice }
}

export function recordUnavailableDeploymentScan(state: RuntimeState, notice: string, check: { blockNumber: bigint; checkedAt: string }) {
	state.lastDeploymentCheckedBlock = check.blockNumber
	state.lastDeploymentCheckAt = check.checkedAt
	state.deploymentNotice = notice
	state.error = undefined
	state.evaluations = unavailableOperationCatalog(notice)
}
