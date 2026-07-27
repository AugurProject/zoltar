#!/usr/bin/env bun

import { createPublicClient, createWalletClient, encodeDeployData, getAddress, http, privateKeyToAccount, zeroAddress, type Hex } from '@zoltar/shared/ethereum'
import { peripherals_OpenOracleArbitrageExecutor_OpenOracleArbitrageExecutor as executorArtifact } from '../solidity/ts/types/contractArtifact.js'
import { defaultRpcUrl, networkConfiguration, parseNetworkName } from './network.js'

function option(name: string) {
	const prefix = `--${name}=`
	return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
	console.log(`Deploy the OpenOracle arbitrage executor

PRIVATE_KEY=0x... ./open-oracle-arbitrager/deploy-executor [options]

  --network=mainnet|sepolia
  --rpc-url=https://...

The command verifies the selected chain, deploys the stateless executor, waits for
confirmation, and prints the address to pass as --executor-address.`)
	process.exit(0)
}

const privateKeyValue = process.env['PRIVATE_KEY']
if (privateKeyValue === undefined || !/^0x[0-9a-fA-F]{64}$/.test(privateKeyValue)) throw new Error('PRIVATE_KEY must be a 32-byte 0x-prefixed deployment key')
const networkName = parseNetworkName(option('network'))
const network = networkConfiguration(networkName, { rep: networkName === 'sepolia' ? zeroAddress : undefined })
const rpcUrl = option('rpc-url') ?? process.env['ETH_RPC_URL'] ?? defaultRpcUrl(networkName)
const account = privateKeyToAccount(privateKeyValue as Hex)
const publicClient = createPublicClient({ chain: network.chain, transport: http(rpcUrl) })
const observedChainId = await publicClient.getChainId()
if (observedChainId !== network.chain.id) throw new Error(`RPC chain mismatch: expected ${network.chain.id.toString()}, received ${observedChainId.toString()}`)
const wallet = createWalletClient({ account, chain: network.chain, transport: http(rpcUrl) })
const hash = await wallet.sendTransaction({
	data: encodeDeployData({
		abi: executorArtifact.abi,
		bytecode: `0x${executorArtifact.evm.bytecode.object}`,
	}),
})
console.log(`deployment=${hash} network=${networkName} deployer=${account.address}`)
const receipt = await publicClient.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success') throw new Error(`Executor deployment reverted: ${receipt.transactionHash}`)
if (receipt.contractAddress === null || receipt.contractAddress === undefined) throw new Error('Executor deployment receipt did not contain a contract address')
const code = await publicClient.getCode({ address: receipt.contractAddress })
if (code === undefined || code === '0x') throw new Error('Executor deployment address has no contract code')
console.log(`executor=${getAddress(receipt.contractAddress)} block=${receipt.blockNumber.toString()}`)
