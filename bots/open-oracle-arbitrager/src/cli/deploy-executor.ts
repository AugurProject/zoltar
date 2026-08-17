#!/usr/bin/env bun

import { privateKeyToAccount, zeroAddress, type Hex } from '#ethereum'
import { defaultConfigurationFile } from '#config/configuration'
import { loadOperatorSettings } from '#config/settings-store'
import { defaultRpcUrl, networkConfiguration, parseNetworkName } from '#config/network'
import { deployExecutorCreate2, executorDeploymentPlan } from '#execution/create2-executor'
import { acquireExecutorDeploymentIntentLock, clearExecutorDeploymentIntent, executorDeploymentIntentPath, loadExecutorDeploymentIntent, saveExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { acquireExecutionSignerLock } from '#state/position-store'
import { resolve } from 'node:path'
import { configuredQuorumRpcUrlMinimum } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

function option(name: string) {
	const prefix = `--${name}=`
	return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
}

function options(name: string) {
	const prefix = `--${name}=`
	return process.argv.filter(argument => argument.startsWith(prefix)).map(argument => argument.slice(prefix.length))
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
	console.log(`Deploy the OpenOracle arbitrage executor

PRIVATE_KEY=0x... bun run deploy-executor -- [options]

  --network=mainnet|sepolia
  --rpc-url=https://...
  --quorum-rpc-url=https://... Optional; saved quorum 2 requires two
  --salt=0x...                  32-byte CREATE2 salt; defaults to zero

The saved RPC agreement requirement defaults to one reader, so the primary RPC is
sufficient. Select quorum 2 in the dashboard to require two additional independent
RPC origins.

The command predicts and deploys the stateless executor through the canonical
CREATE2 proxy, verifies its runtime bytecode, and prints the stable address.`)
	process.exit(0)
}

const privateKeyValue = process.env['PRIVATE_KEY']
if (privateKeyValue === undefined || !/^0x[0-9a-fA-F]{64}$/.test(privateKeyValue)) throw new Error('PRIVATE_KEY must be a 32-byte 0x-prefixed deployment key')
const networkName = parseNetworkName(option('network'))
const network = networkConfiguration(networkName, { rep: networkName === 'sepolia' ? zeroAddress : undefined })
const rpcUrl = option('rpc-url') ?? process.env['ETH_RPC_URL'] ?? defaultRpcUrl(networkName)
const quorumRpcUrls = options('quorum-rpc-url')
const settingsFile = resolve(process.env['OPEN_ORACLE_ARBITRAGER_CONFIG'] ?? defaultConfigurationFile)
const savedSettings = await loadOperatorSettings(settingsFile)
const rpcQuorum = savedSettings?.rpcQuorum ?? 2
process.env['ZOLTAR_BOT_RPC_QUORUM'] = rpcQuorum.toString()
if (quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(rpcQuorum)) throw new Error('Executor deployment does not satisfy the saved RPC agreement requirement')
const account = privateKeyToAccount(privateKeyValue as Hex)
const salt = option('salt') ?? `0x${'00'.repeat(32)}`
const plan = executorDeploymentPlan(salt)
const intentPath = executorDeploymentIntentPath(settingsFile)
console.log(`predicted=${plan.address} network=${networkName} deployer=${account.address}`)
const intentLock = await acquireExecutorDeploymentIntentLock(intentPath)
let signerLock: Awaited<ReturnType<typeof acquireExecutionSignerLock>> | undefined
try {
	signerLock = await acquireExecutionSignerLock(network.chain.id, account.address)
	const deployment = await deployExecutorCreate2({
		chain: network.chain,
		existingIntent: await loadExecutorDeploymentIntent(intentPath),
		persistIntent: intent => saveExecutorDeploymentIntent(intentPath, intent),
		privateKey: privateKeyValue as Hex,
		readRpcUrls: [rpcUrl, ...quorumRpcUrls],
		rpcUrls: [rpcUrl],
		salt,
	})
	await clearExecutorDeploymentIntent(intentPath)
	console.log(`executor=${deployment.address} transaction=${deployment.transactionHash ?? 'already-deployed'}`)
} finally {
	try {
		if (signerLock !== undefined) await signerLock.release()
	} finally {
		await intentLock.release()
	}
}
