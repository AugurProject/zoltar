#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPublicClient, http, type Address } from '@zoltar/bot-shared/ethereum'
import { parseDeploymentManifest, verifyDeploymentManifest } from '#config/deployment-auth'
import { defaultRpcUrl, networkConfiguration } from '#config/network'

function option(name: string) {
	const prefix = `--${name}=`
	return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
}

function usage() {
	console.log(`Verify optional, independently reviewed bytecode pins

bun run manifest -- verify \\
  --rpc-url=https://... --manifest=/secure/operator/sepolia-execution-manifest.json

Canonical deployment addresses are bundled with the bot. RPC responses are used
only to verify deployments, never to generate trusted identities.`)
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
if (command !== 'verify') {
	usage()
	throw new Error('Choose verify; RPC-derived manifest generation is not supported')
}

const manifestPath = option('manifest')
if (manifestPath === undefined) throw new Error('verify requires --manifest=PATH')
const manifest = await readManifest(manifestPath)
const network = networkConfiguration(manifest.network)
const rpcUrl = option('rpc-url') ?? process.env['ETH_RPC_URL'] ?? defaultRpcUrl(manifest.network)
const client = createPublicClient({ chain: network.chain, transport: http(rpcUrl) })
const chainId = await client.getChainId()
if (chainId !== manifest.chainId) throw new Error(`RPC chain mismatch: manifest ${manifest.chainId.toString()}, received ${chainId.toString()}`)
await verifyDeploymentManifest(manifest, (address: Address) => client.getCode({ address }))
console.log(`verified=${resolve(manifestPath)} contracts=${manifest.contracts.length.toString()} chain=${manifest.chainId.toString()}`)
