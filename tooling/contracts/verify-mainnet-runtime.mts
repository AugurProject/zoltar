import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { http, keccak256, requestRpc, type Hex, type Transport } from '@zoltar/core-shared/evm/ethereum'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'
import { MAINNET_NETWORK_PROFILE, getGenesisNetworkProfile } from '../../ui/coreShared/ts/wallet/networkProfile.ts'
import { getDeploymentSteps } from '../../ui/statoblastShared/ts/protocol/deployment.ts'
import { getDeploymentSteps as getZoltarSteps } from '../../ui/zoltarShared/ts/protocol/deployment.ts'
import { getBootstrapDescendantAddresses } from '../../ui/statoblastShared/ts/protocol/deploymentHelpers.ts'
import { EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES, EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES } from './bootstrap-descendant-hashes.mts'
import { getPinnedTradingDeploymentSteps } from './deployment-plan.mts'
import { repositoryRoot } from '../repo/root.mts'

function isHash(value: unknown): value is Hex {
	return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function isRuntimeCode(value: unknown): value is Hex {
	return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value)
}

type Target = { id: string; address: string; expectedRuntimeCodeHash?: string | undefined; source: string }

function externalToken(id: string, address: string, pins: unknown): Target {
	const pin = isPlainRecord(pins) ? pins[address.toLowerCase()] : undefined
	if (!isPlainRecord(pin) || !isHash(pin['hash']) || typeof pin['source'] !== 'string' || !pin['source'].trim()) throw new Error(`Provide an independently reviewed hash and source for ${id} at ${address.toLowerCase()}`)
	return { id, address, expectedRuntimeCodeHash: pin['hash'].toLowerCase(), source: pin['source'] }
}

export function mainnetTargets(genesis: 'yes' | 'no', pins: unknown): Target[] {
	const profile = getGenesisNetworkProfile(MAINNET_NETWORK_PROFILE, genesis)
	const hashes = { ...EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES.mainnet, ...(genesis === 'no' ? EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES.mainnet : {}) }
	const oracle = getZoltarSteps(profile).find(step => step.id === 'deploymentStatusOracle')
	if (!oracle) throw new Error('Missing Zoltar deployment status oracle')
	const steps = [...getDeploymentSteps(profile), { ...oracle, id: 'zoltarDeploymentStatusOracle' }, ...getPinnedTradingDeploymentSteps(profile, 'mainnet')]
	return [
		...steps.map(({ id, address, expectedRuntimeCodeHash }) => ({ id, address, expectedRuntimeCodeHash, source: 'repository deployment plan' })),
		...Object.entries(getBootstrapDescendantAddresses(profile)).map(([id, address]) => ({ id, address, expectedRuntimeCodeHash: hashes[id], source: 'repository bootstrap descendant pins' })),
		externalToken('genesisRep', profile.genesisRepTokenAddress, pins),
		externalToken('weth', profile.wethAddress, pins),
	]
}

export async function verifyMainnetRuntime(transport: Transport, deployments: { genesis: 'yes' | 'no'; targets: Target[] }[]) {
	const chainId = await requestRpc<unknown>(transport, { method: 'eth_chainId' })
	if (chainId !== '0x1') throw new Error('Expected Ethereum mainnet chain ID 0x1')
	const block = await requestRpc<unknown>(transport, { method: 'eth_getBlockByNumber', params: ['finalized', false] })
	if (!isPlainRecord(block) || !isHash(block['hash']) || typeof block['number'] !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(block['number'])) throw new Error('RPC did not return a finalized block number and hash')
	const blockHash = block['hash']
	const results = []
	const codeHashes = new Map<string, string | undefined>()
	for (const { genesis, targets } of deployments) {
		for (const target of targets) {
			if (!isHash(target.expectedRuntimeCodeHash)) throw new Error(`Missing expected runtime hash for ${target.id}`)
			const address = target.address.toLowerCase()
			if (!codeHashes.has(address)) {
				const code = await requestRpc<unknown>(transport, { method: 'eth_getCode', params: [address, { blockHash, requireCanonical: true }] })
				if (!isRuntimeCode(code)) throw new Error(`Invalid runtime code response at ${address}`)
				codeHashes.set(address, code === '0x' ? undefined : keccak256(code))
			}
			const observedRuntimeCodeHash = codeHashes.get(address)
			const matches = observedRuntimeCodeHash === target.expectedRuntimeCodeHash
			const codeStatus = matches ? 'match' : 'mismatch'
			results.push({ genesis, ...target, observedRuntimeCodeHash, status: observedRuntimeCodeHash === undefined ? 'missing' : codeStatus })
		}
	}
	return { chainId, blockHash, blockNumber: block['number'], verified: results.every(result => result.status === 'match'), results }
}

if (import.meta.main) {
	const [pinsPath, reportPath, ...rest] = process.argv.slice(2)
	const rpcUrl = process.env['MAINNET_RPC_URL']
	if (!rpcUrl || !pinsPath || !reportPath || rest.length) throw new Error('Usage: MAINNET_RPC_URL=... bun run verify:mainnet-runtime <external-token-pins.json> <new-report.json>')
	const pins: unknown = await Bun.file(pinsPath).json()
	const outcomes = ['yes', 'no'] as const
	const report = await verifyMainnetRuntime(
		http(rpcUrl),
		outcomes.map(genesis => ({ genesis, targets: mainnetTargets(genesis, pins) })),
	)
	const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', cwd: repositoryRoot }).trim()
	await writeFile(reportPath, JSON.stringify({ commit: git(['rev-parse', 'HEAD']), dirtyWorktree: Boolean(git(['status', '--porcelain'])), ...report }, undefined, 2) + '\n', { flag: 'wx' })
	if (!report.verified) process.exitCode = 1
}
