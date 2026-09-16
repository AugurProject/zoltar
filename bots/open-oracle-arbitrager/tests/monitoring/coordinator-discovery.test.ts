import { expect, test } from 'bun:test'
import { discoverCoordinatorPolicies } from '#monitoring/coordinator-discovery'
import { canonicalSecurityPoolFactory, networkConfiguration } from '#config/network'
import { parseOperatorSettings } from '#config/settings-store'
import { createDeploymentManifest } from '#config/deployment-auth'
import { securityPoolAbi, securityPoolFactoryAbi, openOraclePriceCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import example from '../../config/operator.example.json'
import { multicallProvider } from '../helpers/multicall-provider.ts'

const settings = parseOperatorSettings({ ...example, approvedUniverses: ['0'] })
const network = networkConfiguration('mainnet')
const factory = canonicalSecurityPoolFactory('mainnet')
const pool = getAddress('0x0000000000000000000000000000000000000011')
const coordinator = getAddress('0x0000000000000000000000000000000000000022')
const other = getAddress('0x0000000000000000000000000000000000000033')
const hash: Hex = `0x${'ab'.repeat(32)}`
const entry = { securityPool: pool, truthAuction: other, priceOracleManagerAndOperatorQueuer: coordinator, shareToken: other, parent: other, universeId: 0n, questionId: 1n, statoblastSecurityMultiplierBps: 20_000n, initialReportPriorityFeeAttoEthPerGas: 1n, currentRetentionRate: 1n, settlementCollateralAttoEth: 0n }

function reader(options: { wrongCoordinator?: boolean; wrongCode?: boolean; wrongBlock?: boolean; unapproved?: boolean; shortPage?: boolean; unsafePolicy?: boolean; registryCount?: bigint; reorg?: boolean } = {}) {
	let blockReads = 0
	const targets: string[] = []
	const provider = multicallProvider(
		network.multicall3,
		({ to, data, blockTag }) => {
			expect(blockTag).toBe('0xa')
			targets.push(to)
			if (to.toLowerCase() === factory.toLowerCase()) {
				const call = decodeFunctionData({ abi: securityPoolFactoryAbi, data })
				if (call.functionName === 'securityPoolDeploymentCount') return encodeAbiParameters([{ type: 'uint256' }], [options.registryCount ?? 1n])
				if (call.functionName !== 'securityPoolDeploymentsRange') throw new Error('Unexpected factory read')
				const fn = securityPoolFactoryAbi.find(item => item.type === 'function' && item.name === 'securityPoolDeploymentsRange')
				if (fn === undefined || fn.type !== 'function') throw new Error('Missing registry ABI')
				const [start, count] = call.args
				return encodeAbiParameters(fn.outputs, [options.shortPage ? [] : Array.from({ length: Number(count) }, (_, index) => ({ ...entry, universeId: options.unapproved || (options.registryCount !== undefined && start + BigInt(index) < options.registryCount - 1n) ? 1n : 0n }))])
			}
			if (to.toLowerCase() === pool.toLowerCase()) {
				const call = decodeFunctionData({ abi: securityPoolAbi, data })
				if (call.functionName === 'universeId') return encodeAbiParameters([{ type: 'uint248' }], [0n])
				return encodeAbiParameters([{ type: 'address' }], [options.wrongCoordinator ? other : coordinator])
			}
			if (to.toLowerCase() !== coordinator.toLowerCase()) throw new Error('Untrusted coordinator queried')
			const call = decodeFunctionData({ abi: openOraclePriceCoordinatorAbi, data })
			if (call.functionName === 'openOracle') return encodeAbiParameters([{ type: 'address' }], [settings.deployment.openOracle])
			if (call.functionName === 'weth') return encodeAbiParameters([{ type: 'address' }], [network.weth])
			if (call.functionName === 'reputationToken' || call.functionName === 'protocolFeeRecipient') return encodeAbiParameters([{ type: 'address' }], [network.rep])
			if (call.functionName === 'timeType' || call.functionName === 'trackDisputes') return encodeAbiParameters([{ type: 'bool' }], [true])
			const multiplier = options.unsafePolicy ? 201n : 110n
			return encodeAbiParameters([{ type: 'uint256' }], [call.functionName === 'multiplier' ? multiplier : 1n])
		},
		({ method, params }) => {
			if (method === 'eth_getCode') return options.wrongCode ? '0x02' : '0x01'
			if (method === 'eth_getBlockByNumber') {
				expect(params).toEqual(['0xa', false])
				blockReads++
				return { number: '0xa', hash: options.wrongBlock || (options.reorg && blockReads > 1) ? `0x${'cd'.repeat(32)}` : hash, timestamp: '0x64', baseFeePerGas: '0x1', transactions: [] }
			}
			throw new Error(`Unexpected RPC ${method}`)
		},
	)
	return { targets, client: createPublicClient({ chain: network.chain, transport: custom(provider) }) }
}

async function configuration() {
	return {
		network,
		openOracle: settings.deployment.openOracle,
		operatorSettings: settings,
		execute: true,
		deploymentManifest: await createDeploymentManifest('mainnet', 1, [{ address: factory, role: 'security-pool-factory' }], async () => '0x01'),
		connectivity: settings.connectivity,
		quorumRpcUrls: ['https://second.example'],
	}
}

test('trusts coordinators through the authenticated pool registry without individual coordinator pins', async () => {
	const client = reader()
	const policies = await discoverCoordinatorPolicies([client.client], await configuration(), 10n, hash)
	expect(policies.map(policy => policy.coordinator)).toEqual([coordinator])
	expect(client.targets).toContain(pool)
})

test('dry-run discovery completes with one reader when execution quorum is two', async () => {
	const previous = process.env['ZOLTAR_BOT_RPC_QUORUM']
	process.env['ZOLTAR_BOT_RPC_QUORUM'] = '2'
	try {
		const config = await configuration()
		const policies = await discoverCoordinatorPolicies([reader().client], { ...config, execute: false }, 10n, hash)
		expect(policies.map(policy => policy.coordinator)).toEqual([coordinator])
		await expect(discoverCoordinatorPolicies([reader().client], config, 10n, hash)).rejects.toThrow('two available independent RPC endpoints')
		expect((await discoverCoordinatorPolicies([reader().client, reader().client], config, 10n, hash)).map(policy => policy.coordinator)).toEqual([coordinator])
	} finally {
		if (previous === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
		else process.env['ZOLTAR_BOT_RPC_QUORUM'] = previous
	}
})

test('only discovers approved universes and removes coordinators after approval changes', async () => {
	const client = reader({ unapproved: true })
	expect(await discoverCoordinatorPolicies([client.client], await configuration(), 10n, hash)).toEqual([])
	expect(client.targets).not.toContain(pool)
	const config = await configuration()
	expect(await discoverCoordinatorPolicies([], { ...config, operatorSettings: { ...settings, approvedUniverses: [] } }, 10n, hash)).toEqual([])
})

for (const [name, options, error] of [
	['pool link', { wrongCoordinator: true }, 'inconsistent coordinator'],
	['changed block', { reorg: true }, 'canonical block'],
	['registry limit', { registryCount: 10_001n }, 'discovery limit'],
	['factory code', { wrongCode: true }, 'runtime bytecode hash'],
	['canonical block', { wrongBlock: true }, 'canonical block'],
	['incomplete registry', { shortPage: true }, 'incomplete page'],
	['unsafe coordinator policy', { unsafePolicy: true }, 'Multiplier exceeds'],
] as const)
	test(`rejects an invalid ${name}`, async () => {
		await expect(discoverCoordinatorPolicies([reader(options).client], await configuration(), 10n, hash)).rejects.toThrow(error)
	})

test('rejects disagreement between otherwise valid registry readers', async () => {
	await expect(discoverCoordinatorPolicies([reader().client, reader({ unapproved: true }).client], await configuration(), 10n, hash)).rejects.toThrow('disagreement')
})

test('discovers an approved pool on a later registry page', async () => {
	const client = reader({ registryCount: 101n })
	const policies = await discoverCoordinatorPolicies([client.client], await configuration(), 10n, hash)
	expect(policies.map(policy => policy.coordinator)).toEqual([coordinator])
	expect(client.targets.filter(target => target.toLowerCase() === factory.toLowerCase())).toHaveLength(3)
})

test('requires a manifest pin for the canonical factory before trusting registry entries', async () => {
	const config = await configuration()
	const deploymentManifest = await createDeploymentManifest('mainnet', 1, [{ address: config.openOracle, role: 'open-oracle' }], async () => '0x01')
	const client = reader()
	await expect(discoverCoordinatorPolicies([client.client], { ...config, deploymentManifest }, 10n, hash)).rejects.toThrow('missing security-pool-factory')
	expect(client.targets).toEqual([])
})
