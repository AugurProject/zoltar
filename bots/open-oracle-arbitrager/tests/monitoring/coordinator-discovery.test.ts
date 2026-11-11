import { expect, test } from 'bun:test'
import { discoverCoordinatorPolicies } from '#monitoring/coordinator-discovery'
import { canonicalSecurityPoolFactory, networkConfiguration } from '#config/network'
import { parseOperatorSettings } from '#config/settings-store'
import { securityPoolAbi, securityPoolFactoryAbi, openOraclePriceCoordinatorAbi, sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import example from '../../config/operator.example.json'
import { multicallProvider } from '../helpers/multicall-provider.ts'

const settings = parseOperatorSettings({ ...example, approvedUniverses: ['0'] })
const network = networkConfiguration('mainnet')
const factory = canonicalSecurityPoolFactory('mainnet')
const pool = getAddress('0x0000000000000000000000000000000000000011')
const coordinator = getAddress('0x0000000000000000000000000000000000000022')
const secondPool = getAddress('0x0000000000000000000000000000000000000055')
const feed = getAddress('0x0000000000000000000000000000000000000044')
const other = getAddress('0x0000000000000000000000000000000000000033')
const hash: Hex = `0x${'ab'.repeat(32)}`
const portfolio = getAddress('0x0000000000000000000000000000000000000066')
const escrowFeedCall = encodeFunctionData({ abi: [{ type: 'function', name: 'feed', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }], functionName: 'feed' })
const entry = { securityPool: pool, collateralRepairAuction: other, openOraclePriceCoordinator: coordinator, shareToken: other, parent: other, universeId: 0n, questionId: 1n, statoblastSecurityMultiplierBps: 20_000n, initialReportPriorityFeeAttoEthPerGas: 1n, currentRetentionRate: 1n, settlementCollateralAttoEth: 0n }

function reader(options: { sharedFeed?: boolean; missingEscrow?: boolean; wrongCoordinator?: boolean; missingCode?: boolean; wrongBlock?: boolean; unapproved?: boolean; shortPage?: boolean; unsafePolicy?: boolean; registryCount?: bigint; reorg?: boolean; wrongFeedBinding?: boolean } = {}) {
	let blockReads = 0
	const targets: string[] = []
	const provider = multicallProvider(
		network.multicall3,
		({ to, data, blockTag }) => {
			expect(blockTag).toBe('0xa')
			targets.push(to)
			if (options.sharedFeed && data === escrowFeedCall && [other, secondPool].includes(to)) return encodeAbiParameters([{ type: 'address' }], [feed])
			if (to.toLowerCase() === factory.toLowerCase()) {
				const call = decodeFunctionData({ abi: securityPoolFactoryAbi, data })
				if (call.functionName === 'sharedPriceFeeds') return encodeAbiParameters([{ type: 'address' }], [options.wrongFeedBinding ? other : feed])
				if (call.functionName === 'securityPoolDeploymentCount') return encodeAbiParameters([{ type: 'uint256' }], [options.registryCount ?? 1n])
				if (call.functionName !== 'securityPoolDeploymentsRange') throw new Error('Unexpected factory read')
				const fn = securityPoolFactoryAbi.find(item => item.type === 'function' && item.name === 'securityPoolDeploymentsRange')
				if (fn === undefined || fn.type !== 'function') throw new Error('Missing registry ABI')
				const [start, count] = call.args
				return encodeAbiParameters(fn.outputs, [
					options.shortPage
						? []
						: Array.from({ length: Number(count) }, (_, index) => ({
								...entry,
								...(options.sharedFeed && index === 1 ? { securityPool: secondPool, openOraclePriceCoordinator: other } : {}),
								universeId: options.unapproved || (!options.sharedFeed && options.registryCount !== undefined && start + BigInt(index) < options.registryCount - 1n) ? 1n : 0n,
							})),
				])
			}
			if (to.toLowerCase() === pool.toLowerCase() || to.toLowerCase() === secondPool.toLowerCase()) {
				const call = decodeFunctionData({ abi: securityPoolAbi, data })
				if (call.functionName === 'universeId') return encodeAbiParameters([{ type: 'uint248' }], [0n])
				return encodeAbiParameters([{ type: 'address' }], [options.wrongCoordinator || to.toLowerCase() === secondPool.toLowerCase() ? other : coordinator])
			}
			if (to.toLowerCase() !== coordinator.toLowerCase() && (!options.sharedFeed || (to.toLowerCase() !== feed.toLowerCase() && to.toLowerCase() !== other.toLowerCase()))) throw new Error('Untrusted coordinator queried')
			const call = decodeFunctionData({ abi: [...openOraclePriceCoordinatorAbi, ...sharedPoolPriceFeedAbi], data })
			if (call.functionName === 'portfolio') return encodeAbiParameters([{ type: 'address' }], [portfolio])
			if (call.functionName === 'universeId') return encodeAbiParameters([{ type: 'uint248' }], [options.unapproved ? 1n : 0n])
			if (call.functionName === 'pendingReportId') return encodeAbiParameters([{ type: 'uint256' }], [7n])
			if (call.functionName === 'reportCandidates') {
				const fn = sharedPoolPriceFeedAbi.find(item => item.type === 'function' && item.name === 'reportCandidates')
				if (fn === undefined || fn.type !== 'function') throw new Error('Missing candidate ABI')
				const candidate = call.args[0] === 7n ? other : secondPool
				const escrow = options.missingEscrow || call.args[0] === 9n ? '0x0000000000000000000000000000000000000000' : candidate
				return encodeAbiParameters(fn.outputs, [escrow, other, coordinator, 1n, 1n, 1n])
			}
			if (call.functionName === 'priceFeed') return encodeAbiParameters([{ type: 'address' }], [options.sharedFeed ? feed : coordinator])
			if (call.functionName === 'openOracle') return encodeAbiParameters([{ type: 'address' }], [settings.deployment.openOracle])
			if (call.functionName === 'weth') return encodeAbiParameters([{ type: 'address' }], [network.weth])
			if (call.functionName === 'reputationToken' || call.functionName === 'protocolFeeRecipient') return encodeAbiParameters([{ type: 'address' }], [network.rep])
			if (call.functionName === 'timeType' || call.functionName === 'trackDisputes') return encodeAbiParameters([{ type: 'bool' }], [true])
			const multiplier = options.unsafePolicy ? 201n : 110n
			return encodeAbiParameters([{ type: 'uint256' }], [call.functionName === 'multiplier' ? multiplier : 1n])
		},
		({ method, params }) => {
			if (method === 'eth_getCode') {
				if (options.missingCode) return '0x'
				return '0x01'
			}
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
		connectivity: settings.connectivity,
		quorumRpcUrls: ['https://second.example'],
		rpcQuorum: 1 as const,
	}
}

const reports = [
	{ reportId: 6n, creator: secondPool },
	{ reportId: 7n, creator: other },
]

test('discovers every concurrent report without reading question registries', async () => {
	const client = reader({ sharedFeed: true, registryCount: 10_001n })
	const policies = await discoverCoordinatorPolicies([client.client], await configuration(), 10n, hash, [], reports)
	expect(policies.map(policy => policy.coordinator)).toEqual([feed])
	expect(policies[0]?.reportEscrows).toEqual({ '6': secondPool, '7': other })
	expect(client.targets).not.toContain(pool)
})

test('dry runs use one reader; execution requires the configured quorum', async () => {
	const config = { ...(await configuration()), rpcQuorum: 2 as const }
	const client = () => reader({ sharedFeed: true }).client
	expect(await discoverCoordinatorPolicies([client()], { ...config, execute: false }, 10n, hash, [], reports)).toHaveLength(1)
	await expect(discoverCoordinatorPolicies([client()], config, 10n, hash, [], reports)).rejects.toThrow('two available independent RPC endpoints')
	expect(await discoverCoordinatorPolicies([client(), client()], config, 10n, hash, [], reports)).toHaveLength(1)
})

test('only discovers approved universes and removes feeds after approval changes', async () => {
	const config = await configuration()
	expect(await discoverCoordinatorPolicies([reader({ sharedFeed: true, unapproved: true }).client], config, 10n, hash, [], reports)).toEqual([])
	expect(await discoverCoordinatorPolicies([], { ...config, operatorSettings: { ...settings, approvedUniverses: [] } }, 10n, hash, [], reports)).toEqual([])
})

for (const [name, options, error] of [
	['changed block', { reorg: true }, 'canonical block'],
	['canonical block', { wrongBlock: true }, 'canonical block'],
	['unsafe feed policy', { unsafePolicy: true }, 'Multiplier exceeds'],
	['factory code', { missingCode: true }, 'Canonical security pool factory is not deployed'],
	['candidate binding', { missingEscrow: true }, 'pending report has no authenticated escrow'],
] as const)
	test(`rejects an invalid ${name}`, async () => {
		await expect(discoverCoordinatorPolicies([reader({ ...options, sharedFeed: true }).client], await configuration(), 10n, hash, [], reports)).rejects.toThrow(error)
	})

test('rejects disagreement between otherwise valid readers', async () => {
	await expect(discoverCoordinatorPolicies([reader({ sharedFeed: true }).client, reader({ sharedFeed: true, unapproved: true }).client], await configuration(), 10n, hash, [], reports)).rejects.toThrow('disagreement')
})

test('retains older authenticated report identities, ignoring absent candidates', async () => {
	const policies = await discoverCoordinatorPolicies(
		[reader({ sharedFeed: true }).client],
		await configuration(),
		10n,
		hash,
		[6n, 9n],
		[reports[1]].filter(report => report !== undefined),
	)
	expect(policies[0]?.reportEscrows).toEqual({ '6': secondPool, '7': other })
})

test('discovers questionless portfolio feeds through canonical bindings', async () => {
	const policies = await discoverCoordinatorPolicies([reader({ sharedFeed: true, registryCount: 0n }).client], await configuration(), 10n, hash, [], reports)
	expect(policies.map(policy => policy.coordinator)).toEqual([feed])
	expect(policies[0]?.reportEscrows).toEqual({ '6': secondPool, '7': other })
})

test('an observed escrow cannot introduce a feed outside the canonical factory binding', async () => {
	const policies = await discoverCoordinatorPolicies([reader({ sharedFeed: true, wrongFeedBinding: true }).client], await configuration(), 10n, hash, [], reports)
	expect(policies).toEqual([])
})
