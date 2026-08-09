import { describe, expect, test } from 'bun:test'
import { getAddress, type Address, type Hex } from '@zoltar/shared/ethereum'
import { getBootstrapDescendantAddresses, getInfraContractAddresses } from '../ui/ts/protocol/deploymentHelpers.ts'
import { SEPOLIA_NETWORK_PROFILE } from '../ui/ts/lib/networkProfile.ts'
import { assertCancunCompatible, assertNoPendingDeployerTransactions, createCompleteDeploymentPlan, deployTestnet, parseChainId, parsePrivateKey, parseRpcUrl, runDeploymentPlan } from './deploy-testnet.mts'
import { getUniswapDeployment } from './uniswap-deployment.mts'

const FIRST_ADDRESS = getAddress('0x0000000000000000000000000000000000000001')
const SECOND_ADDRESS = getAddress('0x0000000000000000000000000000000000000002')
const FIRST_HASH = '0x0101010101010101010101010101010101010101010101010101010101010101'
const SECOND_HASH = '0x0202020202020202020202020202020202020202020202020202020202020202'

describe('testnet deployment inputs', () => {
	test('defaults the chain ID to Sepolia and requires an explicitly selected RPC', () => {
		expect(parseChainId(undefined)).toBe(11_155_111)
		expect(() => parseRpcUrl(undefined)).toThrow('RPC_URL or --rpc-url is required')
		expect(parseRpcUrl('https://rpc.example.test/path')).toBe('https://rpc.example.test/path')
	})

	for (const value of ['', ' ']) {
		test(`rejects explicitly blank chain ID ${JSON.stringify(value)}`, () => {
			expect(() => parseChainId(value)).toThrow('canonical positive decimal integer')
		})
	}

	test('accepts custom testnet chain IDs but refuses mainnet and unsafe RPC URLs', () => {
		expect(parseChainId('84532')).toBe(84_532)
		expect(() => parseChainId('1')).toThrow('refuses Ethereum mainnet')
		expect(() => parseChainId('1.5')).toThrow('canonical positive decimal integer')
		expect(() => parseChainId('011155111')).toThrow('without leading zeros')
		expect(parseRpcUrl('http://127.0.0.1:8545')).toBe('http://127.0.0.1:8545/')
		expect(() => parseRpcUrl('http://rpc.example.test')).toThrow('HTTPS or loopback HTTP')
		expect(() => parseRpcUrl('https://user:password@rpc.example.test')).toThrow('must not contain embedded credentials')
	})

	test('accepts only a complete 0x-prefixed private key', () => {
		const privateKey = '0x1212121212121212121212121212121212121212121212121212121212121212'
		expect(parsePrivateKey(privateKey)).toBe(privateKey)
		expect(() => parsePrivateKey('0x12')).toThrow('32-byte 0x-prefixed')
		expect(() => parsePrivateKey(undefined)).toThrow('32-byte 0x-prefixed')
	})

	test('uses the same canonicalized chain input for workflow concurrency and deployment', async () => {
		const workflow = await Bun.file(new URL('./github-actions/deploy-testnet.yml', import.meta.url)).text()
		expect(workflow).toContain('group: testnet-contract-deployment-${{ inputs.chain_id }}')
		expect(workflow).toContain('CHAIN_ID: ${{ inputs.chain_id }}')
	})

	test('refuses to start a deployment while its account has a pending transaction', async () => {
		await expect(
			assertNoPendingDeployerTransactions(
				{
					getTransactionCount: async parameters => (parameters.blockTag === 'pending' ? 2n : 1n),
				},
				FIRST_ADDRESS,
			),
		).rejects.toThrow('has pending transactions')
	})

	test('requires Cancun EVM opcode support before deployment', async () => {
		await expect(
			assertCancunCompatible(
				{
					call: async () => ({ data: '0x0000000000000000000000000000000000000000000000000000000000000001' }),
				},
				11_155_111,
			),
		).resolves.toBeUndefined()
		await expect(
			assertCancunCompatible(
				{
					call: async () => {
						throw new Error('EVM error NotActivated')
					},
				},
				11_155_111,
			),
		).rejects.toThrow('does not support the Cancun EVM opcodes')
	})

	test('enforces chain and RPC safety at the transaction-capable entry point', async () => {
		const privateKey = '0x1212121212121212121212121212121212121212121212121212121212121212'
		await expect(deployTestnet({ chainId: 1, privateKey, rpcUrl: 'https://rpc.example.test' })).rejects.toThrow('refuses Ethereum mainnet')
		await expect(deployTestnet({ chainId: 11_155_111, privateKey, rpcUrl: 'http://rpc.example.test' })).rejects.toThrow('HTTPS or loopback HTTP')
	})
})

describe('testnet deployment plan', () => {
	test('covers every bootstrap infrastructure address and orders every dependency first', async () => {
		const uniswap = await getUniswapDeployment(SEPOLIA_NETWORK_PROFILE.wethAddress)
		const plan = createCompleteDeploymentPlan(SEPOLIA_NETWORK_PROFILE, uniswap)
		const addressSet = new Set(plan.map(step => step.address))
		const infrastructure = getInfraContractAddresses(SEPOLIA_NETWORK_PROFILE)
		const bootstrapDescendants = getBootstrapDescendantAddresses(SEPOLIA_NETWORK_PROFILE)
		const directInfrastructure = [
			infrastructure.escalationGameClaimDelegate,
			infrastructure.escalationGameFactory,
			infrastructure.multicall3,
			infrastructure.openOracle,
			infrastructure.priceOracleManagerAndOperatorQueuerFactory,
			infrastructure.scalarOutcomes,
			infrastructure.securityPoolFactory,
			infrastructure.securityPoolForker,
			infrastructure.securityPoolUtils,
			infrastructure.shareTokenFactory,
			infrastructure.uniformPriceDualCapBatchAuctionFactory,
			infrastructure.zoltar,
			infrastructure.zoltarQuestionData,
		]
		const requiredAddresses = [
			...directInfrastructure,
			SEPOLIA_NETWORK_PROFILE.wethAddress,
			SEPOLIA_NETWORK_PROFILE.genesisRepTokenAddress,
			uniswap.addresses.arachnidCreate2DeployerAddress,
			uniswap.addresses.permit2Address,
			uniswap.addresses.uniswapV3FactoryAddress,
			uniswap.addresses.uniswapV3QuoterAddress,
			uniswap.addresses.uniswapV4PoolManagerAddress,
			uniswap.addresses.uniswapV4QuoterAddress,
		]
		for (const address of requiredAddresses) expect(addressSet.has(address)).toBe(true)
		expect(Object.keys(bootstrapDescendants)).toHaveLength(9)
		expect(new Set(Object.values(bootstrapDescendants)).size).toBe(9)
		for (const address of Object.values(bootstrapDescendants)) expect(addressSet.has(address)).toBe(false)
		expect(bootstrapDescendants.escalationGameProofVerifier).toBe(infrastructure.escalationGameProofVerifier)
		expect(plan.some(step => step.id === 'escalationGameFactory')).toBe(true)
		expect(plan).toHaveLength(23)
		expect(new Set(plan.map(step => step.id)).size).toBe(plan.length)
		expect(new Set(plan.map(step => step.address)).size).toBe(plan.length)
		const indexById = new Map(plan.map((step, index) => [step.id, index]))
		for (const [index, step] of plan.entries()) {
			for (const dependency of step.dependencies) expect(indexById.get(dependency)).toBeLessThan(index)
		}
		expect(plan.find(step => step.id === 'openOracle')?.dependencies).toContain('permit2')
	})

	test('skips existing code and deploys missing dependent steps in order', async () => {
		const code = new Map<Address, Hex>([[FIRST_ADDRESS, '0x01']])
		const deployed: string[] = []
		const client = {
			getCode: async ({ address }: { address: Address }) => code.get(address),
		}
		const results = await runDeploymentPlan(
			[
				{
					address: FIRST_ADDRESS,
					dependencies: [],
					deploy: async () => FIRST_HASH,
					id: 'first',
					label: 'First',
				},
				{
					address: SECOND_ADDRESS,
					dependencies: ['first'],
					deploy: async () => {
						deployed.push('second')
						code.set(SECOND_ADDRESS, '0x02')
						return SECOND_HASH
					},
					id: 'second',
					label: 'Second',
				},
			],
			client,
			() => undefined,
		)

		expect(deployed).toEqual(['second'])
		expect(results).toEqual([
			{ address: FIRST_ADDRESS, id: 'first', label: 'First', status: 'skipped', transactionHash: undefined },
			{ address: SECOND_ADDRESS, id: 'second', label: 'Second', status: 'deployed', transactionHash: SECOND_HASH },
		])
	})

	test('fails when ordering omits a dependency or a successful transaction installs no code', async () => {
		const client = {
			getCode: async () => undefined,
		}
		await expect(
			runDeploymentPlan(
				[
					{
						address: SECOND_ADDRESS,
						dependencies: ['first'],
						deploy: async () => SECOND_HASH,
						id: 'second',
						label: 'Second',
					},
				],
				client,
				() => undefined,
			),
		).rejects.toThrow('requires incomplete deployment step first')

		await expect(
			runDeploymentPlan(
				[
					{
						address: FIRST_ADDRESS,
						dependencies: [],
						deploy: async () => FIRST_HASH,
						id: 'first',
						label: 'First',
					},
				],
				client,
				() => undefined,
			),
		).rejects.toThrow('succeeded without installing code')
	})
})
