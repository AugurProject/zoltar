import { concatHex, getAddress, keccak256, type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { RpcStateRetryWait } from '../../ui/coreShared/ts/lib/rpcStateRetries.ts'
import type { WriteClient } from '../../ui/coreShared/ts/wallet/chainBackend.ts'
import { arachnidCreate2DeployerIsInstalled, deployArachnidCreate2Deployer } from './uniswap-deployment.mts'

const DEVELOPMENT_NODE_CREATOR_BALANCE = 1_000_000_000_000_000_000n

type PublishedContractInstall = { creator: Address; initCode: Hex; kind: 'create'; nonce: bigint } | { creator: Address; deployer: Address; initCode: Hex; kind: 'create2'; salt: Hash }

export type PublishedContract = {
	address: Address
	expectedRuntimeCodeHash: Hash
	id: string
	/** Vendored creation transaction that development nodes replay. */
	install: PublishedContractInstall
	label: string
	transactionHash: Hash
}

export type DevelopmentNodeRpc = (method: string, params: readonly unknown[]) => Promise<unknown>

function hasCode(code: Hex | undefined): code is Hex {
	return code !== undefined && code !== '0x'
}

export function createDevelopmentNodeRpc(rpcUrl: string): DevelopmentNodeRpc {
	return async (method, params) => {
		const response = await fetch(rpcUrl, { body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }), headers: { 'content-type': 'application/json' }, method: 'POST' })
		const payload: unknown = await response.json()
		if (typeof payload !== 'object' || payload === null) throw new Error(`RPC ${method} returned an invalid response`)
		if ('error' in payload && payload.error !== undefined && payload.error !== null) throw new Error(`RPC ${method} failed: ${JSON.stringify(payload.error)}`)
		return 'result' in payload ? payload.result : undefined
	}
}

async function isDevelopmentNode(rpc: DevelopmentNodeRpc) {
	try {
		await rpc('anvil_nodeInfo', [])
		return true
	} catch (error) {
		if (error instanceof Error) return false
		throw error
	}
}

async function sendFromImpersonatedAccount(client: Pick<WriteClient, 'waitForTransactionReceipt'>, rpc: DevelopmentNodeRpc, creator: Address, nonce: bigint | undefined, transaction: { data: Hex; to?: Address }) {
	await rpc('anvil_impersonateAccount', [creator])
	try {
		await rpc('anvil_setBalance', [creator, `0x${DEVELOPMENT_NODE_CREATOR_BALANCE.toString(16)}`])
		if (nonce !== undefined) await rpc('anvil_setNonce', [creator, `0x${nonce.toString(16)}`])
		const hash = await rpc('eth_sendTransaction', [{ ...transaction, from: creator }])
		if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Development node returned an invalid transaction hash')
		const receipt = await client.waitForTransactionReceipt({ hash: hash as Hash })
		if (receipt.status !== 'success') throw new Error(`Development node transaction ${hash} reverted`)
		return receipt
	} finally {
		await rpc('anvil_stopImpersonatingAccount', [creator])
	}
}

async function installPublishedContract(client: WriteClient, rpc: DevelopmentNodeRpc, contract: PublishedContract, wait?: RpcStateRetryWait) {
	if (contract.install.kind === 'create') {
		const receipt = await sendFromImpersonatedAccount(client, rpc, contract.install.creator, contract.install.nonce, { data: contract.install.initCode })
		const created = receipt.contractAddress ?? undefined
		if (created === undefined || getAddress(created) !== contract.address) throw new Error(`${contract.label} was created at ${created === undefined ? 'no address' : getAddress(created)} instead of the published address ${contract.address}`)
		return
	}
	// The published CREATE2 deployment replays through the canonical deployer from the creator's live nonce.
	if (!(await arachnidCreate2DeployerIsInstalled(client))) await deployArachnidCreate2Deployer(client, wait)
	await sendFromImpersonatedAccount(client, rpc, contract.install.creator, undefined, { data: concatHex([contract.install.salt, contract.install.initCode]), to: contract.install.deployer })
}

function assertPublishedRuntimeCode(contract: PublishedContract, code: Hex) {
	const actual = keccak256(code)
	if (actual !== contract.expectedRuntimeCodeHash) throw new Error(`Unexpected runtime code for ${contract.label} at ${contract.address}: expected ${contract.expectedRuntimeCodeHash}, received ${actual}`)
}

/**
 * Verifies that every published contract has Uniswap's exact runtime code. On a
 * development node (Anvil) the missing ones are installed at their published
 * addresses by replaying Uniswap's original creation transactions byte for byte;
 * anywhere else missing contracts abort.
 */
export async function ensurePublishedContracts(client: WriteClient, rpc: DevelopmentNodeRpc, chainId: number, contracts: readonly PublishedContract[], log: (message: string) => void = () => undefined, wait?: RpcStateRetryWait) {
	const missing: PublishedContract[] = []
	for (const contract of contracts) {
		const code = await client.getCode({ address: contract.address })
		if (hasCode(code)) assertPublishedRuntimeCode(contract, code)
		else missing.push(contract)
	}
	if (missing.length === 0) return []
	const missingList = missing.map(contract => `${contract.label} (${contract.address})`).join(', ')
	if (!(await isDevelopmentNode(rpc))) {
		throw new Error(`${missingList} published by Uniswap ${missing.length === 1 ? 'has' : 'have'} no code on chain ${chainId.toString()}. Use an RPC for that network or an Anvil development node.`)
	}
	for (const contract of missing) {
		log(`${contract.label} (${contract.id})\n  ├─ Address: ${contract.address}\n  ├─ Replaying: ${contract.transactionHash}\n  └─ Status: installing on the development node`)
		await installPublishedContract(client, rpc, contract, wait)
		const code = await client.getCode({ address: contract.address })
		if (!hasCode(code)) throw new Error(`${contract.label} installation left no code at ${contract.address}`)
		assertPublishedRuntimeCode(contract, code)
	}
	return missing.map(contract => contract.id)
}
