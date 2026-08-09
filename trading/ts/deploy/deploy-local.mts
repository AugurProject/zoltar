import { promises as fs } from 'node:fs'
import path from 'node:path'
import { encodeDeployData, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'
import { tradingContracts } from '../artifacts/contractArtifact.ts'
import { isRecord, parseCoreDeploymentManifest, requireAddress, requireMatchingChain } from './manifest.ts'

const projectRoot = path.resolve(import.meta.dir, '../..')
const rpcUrl = process.env.TRADING_RPC_URL ?? 'http://127.0.0.1:8545'
const coreManifestPath = process.env.ZOLTAR_DEPLOYMENT_MANIFEST
if (coreManifestPath === undefined) throw new Error('Set ZOLTAR_DEPLOYMENT_MANIFEST to an existing local Zoltar deployment manifest')

async function rpc(method: string, params: readonly unknown[]) {
	const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
	const payload: unknown = await response.json()
	if (!isRecord(payload)) throw new Error(`${method} returned malformed JSON-RPC data`)
	const error = payload.error
	if (isRecord(error)) throw new Error(`${method}: ${String(error.message ?? 'unknown JSON-RPC error')}`)
	return payload.result
}

async function deploy(from: Address, data: Hex) {
	const hash = requireAddressHash(await rpc('eth_sendTransaction', [{ from, data }]), 'deployment transaction hash')
	for (let attempt = 0; attempt < 120; attempt++) {
		const receipt = await rpc('eth_getTransactionReceipt', [hash])
		if (isRecord(receipt)) {
			const address = requireAddress(receipt.contractAddress, 'deployed contract')
			if (receipt.status !== '0x1') throw new Error(`Deployment ${hash} reverted`)
			return { address, transactionHash: hash }
		}
		await Bun.sleep(250)
	}
	throw new Error(`Timed out waiting for ${hash}`)
}

function requireAddressHash(value: unknown, label: string): Hex {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte hex value`)
	return value as Hex
}

const coreManifest: unknown = JSON.parse(await fs.readFile(coreManifestPath, 'utf8'))
const coreDeployment = parseCoreDeploymentManifest(coreManifest)
const securityPoolFactory = coreDeployment.securityPoolFactory
const chainIdHex = await rpc('eth_chainId', [])
if (typeof chainIdHex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chainIdHex)) throw new Error('eth_chainId returned an invalid value')
const chainId = BigInt(chainIdHex)
requireMatchingChain(coreDeployment.chainId, chainId)
const code = await rpc('eth_getCode', [securityPoolFactory, 'latest'])
if (typeof code !== 'string' || code === '0x') throw new Error('Configured SecurityPoolFactory has no code on the selected RPC chain')
const accounts = await rpc('eth_accounts', [])
if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('RPC exposes no unlocked deployment account')
const deployer = requireAddress(process.env.TRADING_DEPLOYER ?? accounts[0], 'TRADING_DEPLOYER')
const feeBps = BigInt(process.env.TRADING_FEE_BPS ?? '30')
if (feeBps < 0n || feeBps >= 10_000n) throw new Error('TRADING_FEE_BPS must be between 0 and 9999')
const artifactDocument: unknown = JSON.parse(await fs.readFile(path.join(projectRoot, 'artifacts/Contracts.json'), 'utf8'))
const factoryContract = tradingContracts['trading/contracts/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
const routerContract = tradingContracts['trading/contracts/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
const factoryArtifact = { abi: factoryContract.abi, bytecode: `0x${factoryContract.evm.bytecode.object}` as const }
const routerArtifact = { abi: routerContract.abi, bytecode: `0x${routerContract.evm.bytecode.object}` as const }
const factoryDeployment = await deploy(deployer, encodeDeployData({ abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode, args: [securityPoolFactory, feeBps] }))
const routerDeployment = await deploy(deployer, encodeDeployData({ abi: routerArtifact.abi, bytecode: routerArtifact.bytecode, args: [factoryDeployment.address] }))
const compiler = isRecord(artifactDocument) ? artifactDocument.compiler : undefined
const settings = isRecord(artifactDocument) ? artifactDocument.settings : undefined
const manifest = {
	network: { chainId: Number(chainId), chainIdHex, rpcUrl },
	core: { securityPoolFactory, sourceManifest: path.resolve(coreManifestPath) },
	trading: { factory: factoryDeployment.address, router: routerDeployment.address, feeBps: Number(feeBps) },
	transactions: { factory: factoryDeployment.transactionHash, router: routerDeployment.transactionHash },
	compiler: { version: compiler, settings },
	bytecodeHashes: { factory: keccak256(factoryArtifact.bytecode), router: keccak256(routerArtifact.bytecode) },
	deployer,
	deployedAt: new Date().toISOString(),
}
await fs.mkdir(path.join(projectRoot, 'deployments'), { recursive: true })
await fs.writeFile(path.join(projectRoot, 'deployments/local.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
console.log(JSON.stringify(manifest, undefined, 2))
