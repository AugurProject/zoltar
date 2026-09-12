import { type Configuration } from '#config/configuration'
import { type PersistedOperatorSettings } from '#config/settings-store'
import { deployExecutorCreate2 } from '#execution/create2-executor'
import { executorDeploymentIntentPath, loadExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { type ConnectivitySettings } from '#monitoring/connectivity'
import { type Hex } from '@zoltar/bot-shared/ethereum'
import { configuredReadRpcEndpointMinimum } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

export async function deployExecutorFromConnectivity(
	parameters: {
		chain: Configuration['network']['chain']
		connectivity: ConnectivitySettings
		existingIntent?: Awaited<ReturnType<typeof loadExecutorDeploymentIntent>> | undefined
		isStopping?: (() => boolean) | undefined
		persistIntent?: Parameters<typeof deployExecutorCreate2>[0]['persistIntent']
		privateKey: Hex
		quorumRpcUrls: readonly string[]
		rpcQuorum: Configuration['rpcQuorum']
		salt: unknown
	},
	deploy: typeof deployExecutorCreate2 = deployExecutorCreate2,
) {
	if (parameters.connectivity.publicRpcUrls.length === 0) throw new Error('Configure a public submission RPC before deploying the executor')
	const readRpcUrls = [parameters.connectivity.readRpcUrl, ...parameters.quorumRpcUrls]
	if (readRpcUrls.length < configuredReadRpcEndpointMinimum(parameters.rpcQuorum)) throw new Error('Executor deployment requires three independently configured read RPC endpoints')
	return await deploy({
		chain: parameters.chain,
		existingIntent: parameters.existingIntent,
		...(parameters.isStopping === undefined ? {} : { isStopping: parameters.isStopping }),
		persistIntent: parameters.persistIntent,
		privateKey: parameters.privateKey,
		readRpcUrls,
		rpcUrls: parameters.connectivity.publicRpcUrls,
		salt: parameters.salt,
	})
}

export function requireActivePersistedNetwork(activeNetwork: Configuration['network']['name'], persistedNetwork: PersistedOperatorSettings['network']) {
	if (persistedNetwork !== activeNetwork) throw new Error('Wait for the saved network to apply at the next scan boundary before deploying the executor')
}

export function requireActivePersistedRpcQuorum(activeRpcQuorum: Configuration['rpcQuorum'], persistedRpcQuorum: PersistedOperatorSettings['rpcQuorum']) {
	if (persistedRpcQuorum !== activeRpcQuorum) throw new Error('Wait for the saved RPC agreement requirement to apply at the next scan boundary before deploying the executor')
}

export function requirePausedExecutorDeployment(execute: boolean, paused: boolean) {
	if (execute && !paused) throw new Error('Pause execution before deploying with the active signer')
}

export async function requireNoPendingExecutorDeployment(settingsFile: string, network: PersistedOperatorSettings['network']) {
	if ((await loadExecutorDeploymentIntent(executorDeploymentIntentPath(settingsFile, network))) !== undefined) throw new Error('Recover the pending executor deployment before resuming execution')
}
