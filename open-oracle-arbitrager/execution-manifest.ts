#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPublicClient, getAddress, http, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { createDeploymentManifest, parseDeploymentManifest, parseDeploymentRole, verifyDeploymentManifest } from './deployment-auth.js'
import { defaultRpcUrl, networkConfiguration, parseNetworkName } from './network.js'

function option(name: string) {
	const prefix = `--${name}=`
	return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
}

function options(name: string) {
	const prefix = `--${name}=`
	return process.argv.filter(argument => argument.startsWith(prefix)).map(argument => argument.slice(prefix.length))
}

function usage() {
	console.log(`Generate or verify a bot execution manifest

./open-oracle-arbitrager/execution-manifest generate \\
  --network=sepolia --rpc-url=https://... \\
  --contract=executor:0x... --contract=open-oracle:0x... \\
  --output=/secure/operator/sepolia-execution-manifest.json

./open-oracle-arbitrager/execution-manifest verify \\
  --rpc-url=https://... --manifest=/secure/operator/sepolia-execution-manifest.json

Repeat --contract for every coordinator, token, router, factory, quoter, WETH,
OpenOracle, and executor trusted for execution.`)
}

function parseContract(value: string) {
	const separator = value.indexOf(':')
	if (separator <= 0) throw new Error(`Contract must use role:address syntax: ${value}`)
	return {
		address: getAddress(value.slice(separator + 1)),
		role: parseDeploymentRole(value.slice(0, separator)),
	}
}

async function readManifest(path: string) {
	let value: unknown
	try {
		value = JSON.parse(await readFile(resolve(path), 'utf8'))
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Execution manifest is not valid JSON: ${error.message}`)
		throw error
	}
	return parseDeploymentManifest(value)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
	usage()
	process.exit(0)
}

const command = process.argv[2]
if (command !== 'generate' && command !== 'verify') {
	usage()
	throw new Error('Choose generate or verify')
}

if (command === 'generate') {
	const networkName = parseNetworkName(option('network'))
	const network = networkConfiguration(networkName, { rep: networkName === 'sepolia' ? zeroAddress : undefined })
	const rpcUrl = option('rpc-url') ?? process.env['ETH_RPC_URL'] ?? defaultRpcUrl(networkName)
	const output = option('output')
	if (output === undefined) throw new Error('generate requires --output=PATH')
	const contracts = options('contract').map(parseContract)
	const client = createPublicClient({ chain: network.chain, transport: http(rpcUrl) })
	const chainId = await client.getChainId()
	if (chainId !== network.chain.id) throw new Error(`RPC chain mismatch: expected ${network.chain.id.toString()}, received ${chainId.toString()}`)
	const manifest = await createDeploymentManifest(networkName, chainId, contracts, (address: Address) => client.getCode({ address }))
	await Bun.write(resolve(output), `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o600 })
	console.log(`generated=${resolve(output)} contracts=${manifest.contracts.length.toString()} chain=${manifest.chainId.toString()}`)
} else {
	const manifestPath = option('manifest')
	if (manifestPath === undefined) throw new Error('verify requires --manifest=PATH')
	const manifest = await readManifest(manifestPath)
	const network = networkConfiguration(manifest.network, { rep: manifest.network === 'sepolia' ? zeroAddress : undefined })
	const rpcUrl = option('rpc-url') ?? process.env['ETH_RPC_URL'] ?? defaultRpcUrl(manifest.network)
	const client = createPublicClient({ chain: network.chain, transport: http(rpcUrl) })
	const chainId = await client.getChainId()
	if (chainId !== manifest.chainId) throw new Error(`RPC chain mismatch: manifest ${manifest.chainId.toString()}, received ${chainId.toString()}`)
	await verifyDeploymentManifest(manifest, (address: Address) => client.getCode({ address }))
	console.log(`verified=${resolve(manifestPath)} contracts=${manifest.contracts.length.toString()} chain=${manifest.chainId.toString()}`)
}
