import { expect, test } from 'bun:test'
import { loadDeploymentStatusOracleSnapshot as loadZoltarDeploymentSnapshot } from '../../ui/zoltarShared/ts/protocol/deployment.ts'
import { hexToBytes, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot as loadStatoblastDeploymentSnapshot } from '../../ui/statoblastShared/ts/protocol/deployment.ts'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, getRuntimeNetworkProfile, setRuntimeNetworkProfile } from '../../ui/coreShared/ts/wallet/networkProfile.ts'
import { createAnvilNodeForConnectionMode, type AnvilNode } from '../../solidity/ts/testSupport/simulator/anvilNode.ts'
import { assertBootstrapDescendantCode, createPreparedDeploymentClient, deployTestnet, runDeploymentPlan } from './deploy-testnet.mts'
import { createCompleteDeploymentPlan } from './deployment-plan.mts'
import { getUniswapDeployment } from './uniswap-deployment.mts'

const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' satisfies Hex
const MAX_FEE_PER_GAS = 100_000_000_000n
const MAX_TOTAL_COST = 20_000_000_000_000_000_000n
// Returns a nonzero theoretical supply for the production REP address. Zoltar's
// constructor requires that external mainnet dependency, but its code is not
// part of the protocol deployment plan under test.
const MAINNET_GENESIS_REP_STUB_RUNTIME_CODE = '0x60015f5260205ff3' satisfies Hex
const TEST_TIMEOUT_MS = 300_000

async function withDeploymentNode<T>(chainId: number, testBody: (node: AnvilNode) => Promise<T>) {
	const node = await createAnvilNodeForConnectionMode(
		{ type: 'spawn-isolated', rpcUrl: '', port: 0 },
		{
			chainId,
			context: 'deployment runtime hash freshness test',
			disableCodeSizeLimit: true,
			gasLimit: 100_000_000n,
			hardfork: 'osaka',
			startTimestamp: 1n,
			zeroFees: false,
		},
	)
	try {
		return await testBody(node)
	} finally {
		await node.dispose()
	}
}

test(
	'Sepolia deployment repairs the missing Zoltar oracle, verifies both apps, and skips installed contracts',
	async () => {
		await withDeploymentNode(11_155_111, async node => {
			const client = createPreparedDeploymentClient({ chain: SEPOLIA_NETWORK_PROFILE.chain, maxFeePerGas: MAX_FEE_PER_GAS, maxTotalCost: MAX_TOTAL_COST, privateKey: ANVIL_PRIVATE_KEY, rpcUrl: node.rpcUrl, log: () => {} })
			const plan = createCompleteDeploymentPlan(SEPOLIA_NETWORK_PROFILE, await getUniswapDeployment(SEPOLIA_NETWORK_PROFILE.wethAddress))
			const existing = await runDeploymentPlan(
				plan.filter(step => step.id !== 'zoltarDeploymentStatusOracle'),
				client,
				() => {},
			)
			expect(existing.every(result => result.status === 'deployed')).toBe(true)
			const deployment = await deployTestnet({
				chainId: 11_155_111,
				log: () => {},
				maxFeePerGas: MAX_FEE_PER_GAS,
				maxTotalCost: MAX_TOTAL_COST,
				privateKey: ANVIL_PRIVATE_KEY,
				rpcUrl: node.rpcUrl,
				writeGitHubSummary: false,
			})
			expect(deployment.results.filter(result => result.status === 'deployed').map(result => result.id)).toEqual(['zoltarDeploymentStatusOracle'])
			expect(deployment.results.filter(result => result.status === 'skipped')).toHaveLength(existing.length)
			const previousProfile = getRuntimeNetworkProfile()
			setRuntimeNetworkProfile(SEPOLIA_NETWORK_PROFILE)
			try {
				expect((await loadZoltarDeploymentSnapshot(client)).applicationDeploymentComplete).toBe(true)
				expect((await loadStatoblastDeploymentSnapshot(client)).applicationDeploymentComplete).toBe(true)
			} finally {
				setRuntimeNetworkProfile(previousProfile)
			}
			const repeated = await deployTestnet({ chainId: 11_155_111, log: () => {}, maxFeePerGas: MAX_FEE_PER_GAS, maxTotalCost: MAX_TOTAL_COST, privateKey: ANVIL_PRIVATE_KEY, rpcUrl: node.rpcUrl, writeGitHubSummary: false })
			expect(repeated.results.every(result => result.status === 'skipped')).toBe(true)
		})
	},
	TEST_TIMEOUT_MS,
)

test(
	'Mainnet runtime hashes match a complete local protocol deployment',
	async () => {
		await withDeploymentNode(1, async node => {
			await node.anvilWindowEthereum.addStateOverrides({
				[MAINNET_NETWORK_PROFILE.genesisRepTokenAddress]: { code: hexToBytes(MAINNET_GENESIS_REP_STUB_RUNTIME_CODE) },
			})
			const client = createPreparedDeploymentClient({
				chain: MAINNET_NETWORK_PROFILE.chain,
				log: () => {},
				maxFeePerGas: MAX_FEE_PER_GAS,
				maxTotalCost: MAX_TOTAL_COST,
				privateKey: ANVIL_PRIVATE_KEY,
				rpcUrl: node.rpcUrl,
			})
			const results = await runDeploymentPlan(getDeploymentSteps(MAINNET_NETWORK_PROFILE), client, () => {})
			expect(results.every(result => result.status === 'deployed')).toBe(true)
			await assertBootstrapDescendantCode(client, MAINNET_NETWORK_PROFILE)
		})
	},
	TEST_TIMEOUT_MS,
)
