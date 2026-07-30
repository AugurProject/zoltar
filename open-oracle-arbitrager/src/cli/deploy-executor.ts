#!/usr/bin/env bun

import { privateKeyToAccount, zeroAddress, type Hex } from '#ethereum'
import { defaultRpcUrl, networkConfiguration, parseNetworkName } from '#config/network'
import { deployExecutorCreate2, executorDeploymentPlan } from '#execution/create2-executor'

function option(name: string) {
	const prefix = `--${name}=`
	return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
	console.log(`Deploy the OpenOracle arbitrage executor

PRIVATE_KEY=0x... ./bin/deploy-executor [options]

  --network=mainnet|sepolia
  --rpc-url=https://...
  --salt=0x...                  32-byte CREATE2 salt; defaults to zero

The command predicts and deploys the stateless executor through the canonical
CREATE2 proxy, verifies its runtime bytecode, and prints the stable address.`)
	process.exit(0)
}

const privateKeyValue = process.env['PRIVATE_KEY']
if (privateKeyValue === undefined || !/^0x[0-9a-fA-F]{64}$/.test(privateKeyValue)) throw new Error('PRIVATE_KEY must be a 32-byte 0x-prefixed deployment key')
const networkName = parseNetworkName(option('network'))
const network = networkConfiguration(networkName, { rep: networkName === 'sepolia' ? zeroAddress : undefined })
const rpcUrl = option('rpc-url') ?? process.env['ETH_RPC_URL'] ?? defaultRpcUrl(networkName)
const account = privateKeyToAccount(privateKeyValue as Hex)
const salt = option('salt') ?? `0x${'00'.repeat(32)}`
const plan = executorDeploymentPlan(salt)
console.log(`predicted=${plan.address} network=${networkName} deployer=${account.address}`)
const deployment = await deployExecutorCreate2({ chain: network.chain, privateKey: privateKeyValue as Hex, rpcUrl, salt })
console.log(`executor=${deployment.address} transaction=${deployment.transactionHash ?? 'already-deployed'}`)
