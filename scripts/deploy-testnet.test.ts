import { describe, expect, test } from 'bun:test'
import { getAddress, getCreateAddress, keccak256, privateKeyToAccount, type Address, type Hex } from '@zoltar/shared/ethereum'
import { getBootstrapDescendantAddresses, getInfraContractAddresses } from '../ui/ts/protocol/deploymentHelpers.ts'
import { SEPOLIA_NETWORK_PROFILE } from '../ui/ts/lib/networkProfile.ts'
import type { WriteClient } from '../ui/ts/lib/chainBackend.ts'
import {
	assertBootstrapDescendantCode,
	assertRequiredEvmCompatible,
	assertEip1559Compatible,
	assertNoPendingDeployerTransactions,
	CONSERVATIVE_DEPLOYMENT_GAS,
	createBudgetedTransactionSender,
	createCompleteDeploymentPlan,
	createDeploymentBudget,
	createDeploymentReceiptWaiter,
	DEPLOYMENT_RECEIPT_TIMEOUT_MILLISECONDS,
	deployTestnet,
	getDeploymentHelp,
	parseDeploymentCommandLine,
	parseChainId,
	parseMaxFeePerGas,
	parseMaxTotalCost,
	parsePrivateKey,
	parseRpcUrl,
	preflightDeploymentPlan,
	runDeploymentPlan,
} from './deploy-testnet.mts'
import { getUniswapDeployment } from './uniswap-deployment.mts'

const FIRST_ADDRESS = getAddress('0x0000000000000000000000000000000000000001')
const SECOND_ADDRESS = getAddress('0x0000000000000000000000000000000000000002')
const FIRST_HASH: Hex = '0x0101010101010101010101010101010101010101010101010101010101010101'
const SECOND_HASH: Hex = '0x0202020202020202020202020202020202020202020202020202020202020202'
const ZERO_HASH: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'

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

	test('accepts a private key command-line option before the environment fallback', () => {
		const commandLinePrivateKey = '0x1212121212121212121212121212121212121212121212121212121212121212'
		const environmentPrivateKey = '0x3434343434343434343434343434343434343434343434343434343434343434'
		expect(
			parseDeploymentCommandLine(['--rpc-url=https://rpc.example.test', `--private-key=${commandLinePrivateKey}`], {
				PRIVATE_KEY: environmentPrivateKey,
			}),
		).toMatchObject({ privateKey: commandLinePrivateKey })
	})

	test('parses positive fee and total deployment limits', () => {
		expect(parseMaxFeePerGas(undefined)).toBe(100_000_000_000n)
		expect(parseMaxFeePerGas('1.5')).toBe(1_500_000_000n)
		expect(parseMaxTotalCost(undefined)).toBe(20_000_000_000_000_000_000n)
		expect(parseMaxTotalCost('0.25')).toBe(250_000_000_000_000_000n)
		for (const value of ['', '0', '-1', 'not-a-number']) {
			expect(() => parseMaxFeePerGas(value)).toThrow('MAX_FEE_PER_GAS_GWEI')
			expect(() => parseMaxTotalCost(value)).toThrow('MAX_TOTAL_COST_ETH')
		}
	})

	test('accepts RPC and cost limits as uppercase command-line assignments', () => {
		const privateKey = '0x1212121212121212121212121212121212121212121212121212121212121212'
		expect(
			parseDeploymentCommandLine(['RPC_URL=https://rpc.example.test', 'MAX_FEE_PER_GAS_GWEI=42', '--MAX_TOTAL_COST_ETH=7.5'], {
				PRIVATE_KEY: privateKey,
			}),
		).toEqual({
			chainId: 11_155_111,
			maxFeePerGas: 42_000_000_000n,
			maxTotalCost: 7_500_000_000_000_000_000n,
			privateKey,
			rpcUrl: 'https://rpc.example.test/',
		})
	})

	test('warns about command history when documenting the private key option', () => {
		expect(getDeploymentHelp()).not.toContain('PRIVATE_KEY=0x')
		expect(getDeploymentHelp()).toContain('--private-key=0x...')
		expect(getDeploymentHelp()).toContain('shell history exposure')
	})

	test('uses the same canonicalized chain input for workflow concurrency and deployment', async () => {
		const workflow = await Bun.file(new URL('../.github/workflows/deploy-testnet.yml', import.meta.url)).text()
		expect(workflow).toContain('group: testnet-contract-deployment-${{ inputs.chain_id }}')
		expect(workflow).toContain('CHAIN_ID: ${{ inputs.chain_id }}')
		expect(workflow).toContain('MAX_FEE_PER_GAS_GWEI: ${{ inputs.max_fee_per_gas_gwei }}')
		expect(workflow).toContain('MAX_TOTAL_COST_ETH: ${{ inputs.max_total_cost_eth }}')
		for (const line of workflow.split('\n').filter(line => line.trim().startsWith('uses:'))) {
			expect(line).toMatch(/uses: [^@]+@[0-9a-f]{40}(?:\s+#.*)?$/)
		}
	})

	test('refreshes contract artifacts before loading the deployment script', async () => {
		const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json()
		expect(packageJson.scripts?.['deploy:testnet']).toStartWith('bun run ensure-contract-artifacts &&')
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

	test('requires the Cancun and Osaka EVM opcodes used by deployed bytecode', async () => {
		await expect(
			assertRequiredEvmCompatible(
				{
					call: async ({ data }) => ({ data: data === '0x5f1e60005260206000f3' ? '0x0000000000000000000000000000000000000000000000000000000000000100' : '0x0000000000000000000000000000000000000000000000000000000000000001' }),
				},
				11_155_111,
			),
		).resolves.toBeUndefined()
		await expect(
			assertRequiredEvmCompatible(
				{
					call: async () => {
						throw new Error('EVM error NotActivated')
					},
				},
				11_155_111,
			),
		).rejects.toThrow('does not support the Cancun EVM opcodes')
		await expect(
			assertRequiredEvmCompatible(
				{
					call: async ({ data }) => {
						if (data === '0x5f1e60005260206000f3') throw new Error('EVM error NotActivated')
						return { data: '0x0000000000000000000000000000000000000000000000000000000000000001' }
					},
				},
				11_155_111,
			),
		).rejects.toThrow('does not support the Osaka CLZ opcode')
	})

	test('requires EIP-1559 even when every deployment step could be skipped', async () => {
		await expect(assertEip1559Compatible({ getBlock: async () => ({ baseFeePerGas: 1n }) as never }, 11_155_111)).resolves.toBeUndefined()
		await expect(assertEip1559Compatible({ getBlock: async () => ({ baseFeePerGas: undefined }) as never }, 84_532)).rejects.toThrow('does not expose the EIP-1559 base fee')
	})

	test('waits significantly longer for deployment transaction receipts', async () => {
		const requests: Parameters<WriteClient['waitForTransactionReceipt']>[0][] = []
		const logs: string[] = []
		const waitForTransactionReceipt = createDeploymentReceiptWaiter(
			{
				waitForTransactionReceipt: async parameters => {
					requests.push(parameters)
					return { blockNumber: 99n, gasUsed: 123_456n, status: 'success', transactionHash: parameters.hash } as never
				},
			},
			message => logs.push(message),
		)

		await waitForTransactionReceipt({ hash: FIRST_HASH })
		await waitForTransactionReceipt({ hash: SECOND_HASH, timeout: 12_345 })

		expect(DEPLOYMENT_RECEIPT_TIMEOUT_MILLISECONDS).toBe(60 * 60 * 1_000)
		expect(requests.map(request => request.timeout)).toEqual([DEPLOYMENT_RECEIPT_TIMEOUT_MILLISECONDS, 12_345])
		expect(logs).toEqual([
			`  ├─ Wait for receipt\n  │  ├─ Transaction: ${FIRST_HASH}\n  │  └─ Timeout: 3600s`,
			`  ├─ Receipt confirmed\n  │  ├─ Transaction: ${FIRST_HASH}\n  │  ├─ Status: success\n  │  ├─ Block: 99\n  │  └─ Gas used: 123456`,
			`  ├─ Wait for receipt\n  │  ├─ Transaction: ${SECOND_HASH}\n  │  └─ Timeout: 12.345s`,
			`  ├─ Receipt confirmed\n  │  ├─ Transaction: ${SECOND_HASH}\n  │  ├─ Status: success\n  │  ├─ Block: 99\n  │  └─ Gas used: 123456`,
		])
	})

	test('enforces chain and RPC safety at the transaction-capable entry point', async () => {
		const privateKey = '0x1212121212121212121212121212121212121212121212121212121212121212'
		await expect(deployTestnet({ chainId: 1, privateKey, rpcUrl: 'https://rpc.example.test' })).rejects.toThrow('refuses Ethereum mainnet')
		await expect(deployTestnet({ chainId: 11_155_111, privateKey, rpcUrl: 'http://rpc.example.test' })).rejects.toThrow('HTTPS or loopback HTTP')
	})
})

describe('testnet deployment transaction authorization', () => {
	const account = privateKeyToAccount('0x1212121212121212121212121212121212121212121212121212121212121212')

	function wallet(overrides: Partial<Pick<WriteClient, 'estimateGas' | 'getBlock' | 'getGasPrice' | 'getTransactionCount' | 'sendTransaction'>> = {}) {
		return {
			estimateGas: async () => 100_000n,
			getBlock: async () => ({ baseFeePerGas: 10n }) as never,
			getGasPrice: async () => 20n,
			getTransactionCount: async () => 7n,
			sendTransaction: async () => FIRST_HASH,
			...overrides,
		} as Pick<WriteClient, 'estimateGas' | 'getBlock' | 'getGasPrice' | 'getTransactionCount' | 'sendTransaction'>
	}

	test('sends EIP-1559 transactions bounded by the authorized fee', async () => {
		let submitted: Parameters<WriteClient['sendTransaction']>[0] | undefined
		const logs: string[] = []
		const send = createBudgetedTransactionSender(
			wallet({
				sendTransaction: async request => {
					submitted = request
					return FIRST_HASH
				},
			}),
			account,
			{ maxFeePerGas: 100n, maxTotalCost: 4_000_001n },
			message => logs.push(message),
		)

		expect(await send({ to: FIRST_ADDRESS, value: 1n })).toBe(FIRST_HASH)
		expect(submitted).toMatchObject({ gas: 130_000n, gasPrice: undefined, maxFeePerGas: 30n, maxPriorityFeePerGas: 10n, nonce: 7n, to: FIRST_ADDRESS, value: 1n })
		expect(logs).toEqual([
			`  ├─ Prepare transaction\n  │  └─ Account: ${account.address}`,
			'  ├─ Estimate transaction\n  │  ├─ Nonce: 7\n  │  ├─ Base fee: 0.00000001 gwei\n  │  ├─ Priority fee: 0.00000001 gwei\n  │  └─ Maximum fee: 0.00000003 gwei',
			`  ├─ Submit transaction\n  │  ├─ Nonce: 7\n  │  ├─ To: ${FIRST_ADDRESS}\n  │  ├─ Gas limit: 130000\n  │  ├─ Value: 0.000000000000000001 ETH\n  │  └─ Maximum cost: 0.000000000003900001 ETH`,
			`  ├─ Transaction submitted\n  │  ├─ Nonce: 7\n  │  └─ Transaction: ${FIRST_HASH}`,
		])
	})

	test('caps padding at the transaction signer gas limit', async () => {
		let submitted: Parameters<WriteClient['sendTransaction']>[0] | undefined
		const send = createBudgetedTransactionSender(
			wallet({
				estimateGas: async () => 26_800_000n,
				sendTransaction: async request => {
					submitted = request
					return FIRST_HASH
				},
			}),
			account,
			{ maxFeePerGas: 100n, maxTotalCost: 1_000_000_000_000n },
		)

		expect(await send({ to: FIRST_ADDRESS })).toBe(FIRST_HASH)
		expect(submitted?.gas).toBe(30_000_000n)
	})

	test('rejects an RPC gas-price suggestion above the authorized maximum before signing', async () => {
		let estimateCalled = false
		let sendCalled = false
		const send = createBudgetedTransactionSender(
			wallet({
				estimateGas: async () => {
					estimateCalled = true
					return 100_000n
				},
				getGasPrice: async () => 101n,
				sendTransaction: async () => {
					sendCalled = true
					return FIRST_HASH
				},
			}),
			account,
			{ maxFeePerGas: 100n, maxTotalCost: 1_000_000_000n },
		)

		await expect(send({ to: FIRST_ADDRESS })).rejects.toThrow('RPC suggested gas price')
		expect(estimateCalled).toBe(false)
		expect(sendCalled).toBe(false)
	})

	test('rejects a transaction that exceeds the remaining total budget before signing', async () => {
		let sendCalled = false
		const send = createBudgetedTransactionSender(
			wallet({
				sendTransaction: async () => {
					sendCalled = true
					return FIRST_HASH
				},
			}),
			account,
			{ maxFeePerGas: 100n, maxTotalCost: 3_900_000n },
		)

		await expect(send({ to: FIRST_ADDRESS, value: 1n })).rejects.toThrow('would exceed the authorized deployment total')
		expect(sendCalled).toBe(false)
	})

	test('rejects an already-funded canonical raw deployment outside the total budget', () => {
		const budget = createDeploymentBudget(9_999_999_999_999_999n)
		expect(() => budget.assertCanonicalRawTransactionCost(FIRST_ADDRESS, 10_000_000_000_000_000n)).toThrow('would exceed the authorized deployment total')
	})

	test('credits canonical funding only to the matching signer and records each raw deployment once', () => {
		const budget = createDeploymentBudget(10_100_000_000_000_000n)
		budget.recordWalletTransaction(10_100_000_000_000_000n)
		budget.recordCanonicalFunding(FIRST_ADDRESS, 10_000_000_000_000_000n)
		expect(() => budget.assertCanonicalRawTransactionCost(FIRST_ADDRESS, 10_000_000_000_000_000n)).not.toThrow()
		budget.recordCanonicalRawTransaction(FIRST_ADDRESS, 10_000_000_000_000_000n)
		budget.recordCanonicalRawTransaction(FIRST_ADDRESS, 10_000_000_000_000_000n)
		expect(() => budget.assertCanonicalRawTransactionCost(SECOND_ADDRESS, 10_000_000_000_000_000n)).toThrow('would exceed the authorized deployment total')
	})
})

describe('testnet deployment plan', () => {
	test('rejects an unaffordable retry before invoking any deployment', async () => {
		let deployCalled = false
		const steps = [
			{
				address: FIRST_ADDRESS,
				dependencies: [],
				deploy: async () => {
					deployCalled = true
					return FIRST_HASH
				},
				expectedRuntimeCodeHash: keccak256('0x01'),
				id: 'first',
				label: 'First',
			},
			{
				address: SECOND_ADDRESS,
				dependencies: ['first'],
				deploy: async () => {
					deployCalled = true
					return SECOND_HASH
				},
				expectedRuntimeCodeHash: keccak256('0x02'),
				id: 'second',
				label: 'Second',
			},
		] as const

		await expect(preflightDeploymentPlan(steps, { getCode: async ({ address }) => (address === FIRST_ADDRESS ? '0x01' : undefined) }, { first: 1_000n, second: 2_000n }, 10n, 19_999n)).rejects.toThrow('estimated upper-bound cost')
		expect(deployCalled).toBe(false)
	})

	test('estimates only missing retry steps and returns a deliberately padded upper bound', async () => {
		const estimate = await preflightDeploymentPlan(
			[
				{
					address: FIRST_ADDRESS,
					dependencies: [],
					deploy: async () => FIRST_HASH,
					expectedRuntimeCodeHash: keccak256('0x01'),
					id: 'first',
					label: 'First',
				},
				{
					address: SECOND_ADDRESS,
					dependencies: ['first'],
					deploy: async () => SECOND_HASH,
					expectedRuntimeCodeHash: keccak256('0x02'),
					id: 'second',
					label: 'Second',
				},
			],
			{ getCode: async ({ address }) => (address === FIRST_ADDRESS ? '0x01' : undefined) },
			{ first: 1_000n, second: 2_000n },
			10n,
			20_000n,
		)

		expect(estimate).toEqual({ estimatedCostAttoEth: 20_000n, estimatedGas: 2_000n, missingStepIds: ['second'] })
	})

	test('includes canonical raw-transaction value in the preflight upper bound', async () => {
		const estimate = await preflightDeploymentPlan(
			[
				{
					address: FIRST_ADDRESS,
					dependencies: [],
					deploy: async () => FIRST_HASH,
					expectedRuntimeCodeHash: keccak256('0x01'),
					id: 'proxyDeployer',
					label: 'Proxy Deployer',
				},
			],
			{ getCode: async () => undefined },
			{ proxyDeployer: 500n },
			10n,
			10_000_000_000_005_000n,
		)

		expect(estimate.estimatedCostAttoEth).toBe(10_000_000_000_005_000n)
	})

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
			uniswap.addresses.uniswapV3SwapRouterAddress,
			uniswap.addresses.uniswapV4PoolManagerAddress,
			uniswap.addresses.uniswapV4QuoterAddress,
		]
		for (const address of requiredAddresses) expect(addressSet.has(address)).toBe(true)
		expect(Object.keys(bootstrapDescendants)).toHaveLength(13)
		expect(new Set(Object.values(bootstrapDescendants)).size).toBe(13)
		for (const address of Object.values(bootstrapDescendants)) expect(addressSet.has(address)).toBe(false)
		expect(bootstrapDescendants.escalationGameProofVerifier).toBe(infrastructure.escalationGameProofVerifier)
		expect(bootstrapDescendants.liquidationApprovalRegistryDeployer).toBe(getCreateAddress({ from: infrastructure.priceOracleManagerAndOperatorQueuerFactory, nonce: 1n }))
		expect(bootstrapDescendants.liquidationApprovalRegistryImplementation).toBe(getCreateAddress({ from: bootstrapDescendants.liquidationApprovalRegistryDeployer, nonce: 1n }))
		expect(bootstrapDescendants.operationBountyBoardFactory).toBe(getCreateAddress({ from: infrastructure.priceOracleManagerAndOperatorQueuerFactory, nonce: 3n }))
		expect(bootstrapDescendants.priceCoordinatorDeploymentWorker).toBe(getCreateAddress({ from: infrastructure.priceOracleManagerAndOperatorQueuerFactory, nonce: 2n }))
		expect(plan.some(step => step.id === 'escalationGameFactory')).toBe(true)
		expect(plan).toHaveLength(24)
		expect(new Set(plan.map(step => step.id)).size).toBe(plan.length)
		expect(new Set(plan.map(step => step.address)).size).toBe(plan.length)
		expect(Object.keys(CONSERVATIVE_DEPLOYMENT_GAS).sort()).toEqual(plan.map(step => step.id).sort())
		const indexById = new Map(plan.map((step, index) => [step.id, index]))
		for (const [index, step] of plan.entries()) {
			expect(CONSERVATIVE_DEPLOYMENT_GAS[step.id]).toBeGreaterThan(0n)
			for (const dependency of step.dependencies) expect(indexById.get(dependency)).toBeLessThan(index)
		}
		expect(plan.find(step => step.id === 'openOracle')?.dependencies).toContain('permit2')
	})

	test('skips existing code and deploys missing dependent steps in order', async () => {
		const code = new Map<Address, Hex>([[FIRST_ADDRESS, '0x01']])
		const deployed: string[] = []
		const logs: string[] = []
		const client = {
			getCode: async ({ address }: { address: Address }) => code.get(address),
		}
		const results = await runDeploymentPlan(
			[
				{
					address: FIRST_ADDRESS,
					dependencies: [],
					deploy: async () => FIRST_HASH,
					expectedRuntimeCodeHash: keccak256('0x01'),
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
					expectedRuntimeCodeHash: keccak256('0x02'),
					id: 'second',
					label: 'Second',
				},
			],
			client,
			message => logs.push(message),
		)

		expect(deployed).toEqual(['second'])
		expect(results).toEqual([
			{ address: FIRST_ADDRESS, id: 'first', label: 'First', status: 'skipped', transactionHash: undefined },
			{ address: SECOND_ADDRESS, id: 'second', label: 'Second', status: 'deployed', transactionHash: SECOND_HASH },
		])
		expect(logs).toEqual([`First (first)\n  ├─ Address: ${FIRST_ADDRESS}\n  └─ Status: already deployed`, `Second (second)\n  ├─ Address: ${SECOND_ADDRESS}`, `  ├─ Transaction: ${SECOND_HASH}\n  └─ Status: deployed`])
	})

	test('reports code installed without a submitted transaction as skipped', async () => {
		let code: Hex | undefined
		const logs: string[] = []
		const results = await runDeploymentPlan(
			[
				{
					address: FIRST_ADDRESS,
					dependencies: [],
					deploy: async () => {
						code = '0x01'
						return ZERO_HASH
					},
					expectedRuntimeCodeHash: keccak256('0x01'),
					id: 'proxyDeployer',
					label: 'Proxy Deployer',
				},
			],
			{ getCode: async () => code },
			message => logs.push(message),
		)

		expect(results).toEqual([{ address: FIRST_ADDRESS, id: 'proxyDeployer', label: 'Proxy Deployer', status: 'skipped', transactionHash: undefined }])
		expect(logs).toEqual([`Proxy Deployer (proxyDeployer)\n  ├─ Address: ${FIRST_ADDRESS}`, '  └─ Status: ready (installed without a submitted transaction)'])
		expect(logs.join('\n')).not.toContain(ZERO_HASH)
	})

	test('fails when ordering omits a dependency or a successful transaction installs no code', async () => {
		const client = {
			getCode: async () => undefined,
		}
		const logs: string[] = []
		await expect(
			runDeploymentPlan(
				[
					{
						address: SECOND_ADDRESS,
						dependencies: ['first'],
						deploy: async () => SECOND_HASH,
						expectedRuntimeCodeHash: keccak256('0x02'),
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
						expectedRuntimeCodeHash: keccak256('0x01'),
						id: 'first',
						label: 'First',
					},
				],
				client,
				message => logs.push(message),
			),
		).rejects.toThrow('succeeded without installing code')
		expect(logs).toEqual([`First (first)\n  ├─ Address: ${FIRST_ADDRESS}`, '  └─ Status: failed'])
	})

	test('closes the contract log when deployment fails', async () => {
		const logs: string[] = []
		await expect(
			runDeploymentPlan(
				[
					{
						address: FIRST_ADDRESS,
						dependencies: [],
						deploy: async () => {
							throw new Error('RPC unavailable')
						},
						expectedRuntimeCodeHash: keccak256('0x01'),
						id: 'first',
						label: 'First',
					},
				],
				{ getCode: async () => undefined },
				message => logs.push(message),
			),
		).rejects.toThrow('RPC unavailable')
		expect(logs).toEqual([`First (first)\n  ├─ Address: ${FIRST_ADDRESS}`, '  └─ Status: failed'])
	})

	test('rejects incorrect code at direct deployment and descendant addresses', async () => {
		await expect(
			runDeploymentPlan(
				[
					{
						address: FIRST_ADDRESS,
						dependencies: [],
						deploy: async () => FIRST_HASH,
						expectedRuntimeCodeHash: keccak256('0x01'),
						id: 'first',
						label: 'First',
					},
				],
				{ getCode: async () => '0x02' },
				() => undefined,
			),
		).rejects.toThrow('Unexpected runtime code for first')

		await expect(assertBootstrapDescendantCode({ getCode: async () => undefined }, SEPOLIA_NETWORK_PROFILE)).rejects.toThrow('Bootstrap descendant liquidationApprovalRegistryDeployer is missing')
		await expect(assertBootstrapDescendantCode({ getCode: async () => '0x1234' }, SEPOLIA_NETWORK_PROFILE)).rejects.toThrow('Unexpected runtime code for liquidationApprovalRegistryDeployer')
	})
})
