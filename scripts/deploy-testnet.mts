#!/usr/bin/env bun

import { appendFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'
import { createWalletClient, defineChain, formatEther, http, keccak256, parseUnits, privateKeyToAccount, type Account, type Address, type Chain, type Hash, type Hex } from '@zoltar/shared/ethereum'
import { getBootstrapDescendantAddresses } from '../ui/ts/protocol/deploymentHelpers.ts'
import { CANONICAL_DEPLOYER_RAW_GAS_PRICE, EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES, getDeploymentSteps, getProxyDeployerActivity, getProxyDeployerFundingShortfall, PROXY_DEPLOYER_RUNTIME_CODE } from '../ui/ts/protocol/deployment.ts'
import { PROXY_DEPLOYER_ADDRESS } from '../ui/ts/protocol/deploymentHelpers.ts'
import { SEPOLIA_NETWORK_PROFILE, type NetworkProfile } from '../ui/ts/lib/networkProfile.ts'
import type { WriteClient } from '../ui/ts/lib/chainBackend.ts'
import { ARACHNID_CREATE2_DEPLOYER_ADDRESS, ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE, getUniswapDeployment, type UniswapDeployment } from './uniswap-deployment.mts'

const DEFAULT_CHAIN_ID = 11_155_111
export const DEFAULT_MAX_FEE_PER_GAS_GWEI = '100'
export const DEFAULT_MAX_TOTAL_COST_ETH = '10'
const CANCUN_CAPABILITY_PROBE = '0x6000600060005e600160005d60005c60005260206000f3'
const CANCUN_CAPABILITY_RESULT = '0x0000000000000000000000000000000000000000000000000000000000000001'
const OSAKA_CAPABILITY_PROBE = '0x5f1e60005260206000f3'
const OSAKA_CAPABILITY_RESULT = '0x0000000000000000000000000000000000000000000000000000000000000100'
const EXPECTED_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	...EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES,
	arachnidCreate2Deployer: '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989',
	escalationGameCreationCodePartOne: '0xbe6a6916d55eeba0175b3a5fde1eb80459724eba114bde0cf7cab81718f3b62f',
	escalationGameCreationCodePartTwo: '0x54a83092515c9171019202e4c5033f73aa6ae6e8ca653ccee918445339ce64dd',
	escalationGameProofVerifier: '0xfc49238fed42490497fb4e8674a8c246e50c23e3ab87bf87b5f1d0f7e4a4393a',
	securityPoolDeployer: '0x8aaa25b23a58d17bfc66cd4aa0e2481e11da3cd8f6cb998ef770e693d50c971d',
	securityPoolDeploymentWorker: '0x479cb8ee68610b3a30e5c2b4da3c8a59ee396ca0bc9e64e9d00b1a5dff0b51dd',
	securityPoolEventEmitter: '0xc534a6454451a2194188b0b2685d0e8c33c4f163601be6c1a5061a9165e90269',
	securityPoolForkerEscalationGameForkerDelegate: '0x73011b8340064a7c9d7a2eb27160bf31c1cecbf0ca443a0891db13d7ed7547ea',
	securityPoolForkerEventEmitter: '0xc534a6454451a2194188b0b2685d0e8c33c4f163601be6c1a5061a9165e90269',
	securityPoolForkerVaultMigrationDelegate: '0x6f64c4c55806ef325a4274d1abefc42ae08ac6f909545c28e2233c2df1631ca8',
	uniswapV3Factory: '0x6377aa1b105d3ee2a54d73d3652812d6209ca56871954f61ad6e87d9c184fa5e',
	uniswapV3Quoter: '0x8410f80f6ddf60c46fe39dc3394f3b245c16d62d1c401f4ebc2d030afbb1a264',
	uniswapV3SwapRouter: '0xf552d94a11865ed5100a536873ca827262cd361e489af067f4759a899833b5f5',
	uniswapV4PoolManager: '0xa761717f06c9ace7b3599d9a5fe795c17ef062a378d317d562f2aea4d52d2c49',
	uniswapV4Quoter: '0x988a8710947628ebe53e490c56f534703e45cf6d31c9707d8e0288d9ff65623b',
}

type DeploymentPlanStep<TClient> = {
	address: Address
	dependencies: readonly string[]
	deploy: (client: TClient) => Promise<Hash>
	expectedRuntimeCodeHash?: Hash
	id: string
	label: string
	verifyRuntimeCode?: (client: TClient, code: Hex) => Promise<void>
}

export type DeploymentStepResult = {
	address: Address
	id: string
	label: string
	status: 'deployed' | 'skipped'
	transactionHash: Hash | undefined
}

type CodeReader = {
	getCode: (parameters: { address: Address }) => Promise<Hex | undefined>
}

function option(name: string, argv = process.argv.slice(2)) {
	const prefix = `--${name}=`
	return argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
}

export function parseChainId(value: string | undefined) {
	if (value === undefined) return DEFAULT_CHAIN_ID
	if (!/^[1-9]\d*$/.test(value)) throw new Error('CHAIN_ID must be a canonical positive decimal integer without leading zeros')
	const chainId = Number(value)
	if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('CHAIN_ID must be a positive safe integer')
	if (chainId === 1) throw new Error('The testnet deployer refuses Ethereum mainnet chain ID 1')
	return chainId
}

export function parseRpcUrl(value: string | undefined) {
	if (value === undefined || value.trim() === '') throw new Error('RPC_URL or --rpc-url is required')
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch (error) {
		if (error instanceof TypeError) throw new Error('RPC_URL must be a valid URL')
		throw error
	}
	const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) throw new Error('RPC_URL must use HTTPS or loopback HTTP')
	if (parsed.username !== '' || parsed.password !== '') throw new Error('RPC_URL must not contain embedded credentials')
	return parsed.toString()
}

export function parsePrivateKey(value: string | undefined) {
	if (!isPrivateKey(value)) throw new Error('PRIVATE_KEY must be a 32-byte 0x-prefixed private key')
	return value
}

function parsePositiveUnits(value: string | undefined, fallback: string, decimals: number, label: string) {
	const normalized = value ?? fallback
	let amount: bigint
	try {
		amount = parseUnits(normalized, decimals)
	} catch (error) {
		throw new Error(`${label} must be a positive decimal amount`, { cause: error })
	}
	if (amount <= 0n) throw new Error(`${label} must be greater than zero`)
	return amount
}

export function parseMaxFeePerGas(value: string | undefined) {
	return parsePositiveUnits(value, DEFAULT_MAX_FEE_PER_GAS_GWEI, 9, 'MAX_FEE_PER_GAS_GWEI')
}

export function parseMaxTotalCost(value: string | undefined) {
	return parsePositiveUnits(value, DEFAULT_MAX_TOTAL_COST_ETH, 18, 'MAX_TOTAL_COST_ETH')
}

function isPrivateKey(value: string | undefined): value is Hex {
	return value !== undefined && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function createDeploymentProfile(chainId: number, rpcUrl: string, uniswapAddresses: UniswapDeployment['addresses']): NetworkProfile {
	const chain = defineChain({
		id: chainId,
		name: chainId === DEFAULT_CHAIN_ID ? 'Sepolia' : `Testnet ${chainId.toString()}`,
		nativeCurrency: {
			decimals: 18,
			name: 'Ether',
			symbol: 'ETH',
		},
		rpcUrls: {
			default: {
				http: [rpcUrl],
			},
		},
	} satisfies Chain)
	return {
		...SEPOLIA_NETWORK_PROFILE,
		chain,
		chainIdHex: `0x${chainId.toString(16)}`,
		displayName: chain.name,
		uniswapV3FactoryAddress: uniswapAddresses.uniswapV3FactoryAddress,
		uniswapV3QuoterAddress: uniswapAddresses.uniswapV3QuoterAddress,
		uniswapV4QuoterAddress: uniswapAddresses.uniswapV4QuoterAddress,
	}
}

function paddedGas(gasEstimate: bigint) {
	return gasEstimate + gasEstimate / 5n + 10_000n
}

type BudgetedWallet = Pick<WriteClient, 'estimateGas' | 'getBlock' | 'getGasPrice' | 'getTransactionCount' | 'sendTransaction'>

export function createDeploymentBudget(maxTotalCost: bigint) {
	const accountedCanonicalSigners = new Set<string>()
	const canonicalFundingCreditAttoEth = new Map<string, bigint>()
	let reservedCostAttoEth = 0n
	const signerKey = (signer: Address) => signer.toLowerCase()
	const rawIncrementalCost = (signer: Address, costAttoEth: bigint) => {
		if (accountedCanonicalSigners.has(signerKey(signer))) return 0n
		const creditAttoEth = canonicalFundingCreditAttoEth.get(signerKey(signer)) ?? 0n
		return costAttoEth > creditAttoEth ? costAttoEth - creditAttoEth : 0n
	}
	const assertWithinBudget = (additionalCostAttoEth: bigint) => {
		if (reservedCostAttoEth + additionalCostAttoEth > maxTotalCost) {
			throw new Error(`Transaction worst-case cost ${formatEther(additionalCostAttoEth)} ETH would exceed the authorized deployment total ${formatEther(maxTotalCost)} ETH; ${formatEther(reservedCostAttoEth)} ETH is already reserved`)
		}
	}
	return {
		assertCanonicalRawTransactionCost: (signer: Address, costAttoEth: bigint) => assertWithinBudget(rawIncrementalCost(signer, costAttoEth)),
		recordCanonicalFunding: (signer: Address, amountAttoEth: bigint) => {
			const key = signerKey(signer)
			canonicalFundingCreditAttoEth.set(key, (canonicalFundingCreditAttoEth.get(key) ?? 0n) + amountAttoEth)
		},
		recordCanonicalRawTransaction: (signer: Address, costAttoEth: bigint) => {
			const key = signerKey(signer)
			if (accountedCanonicalSigners.has(key)) return
			const creditAttoEth = canonicalFundingCreditAttoEth.get(key) ?? 0n
			const creditedAttoEth = costAttoEth < creditAttoEth ? costAttoEth : creditAttoEth
			const incrementalCostAttoEth = costAttoEth - creditedAttoEth
			assertWithinBudget(incrementalCostAttoEth)
			canonicalFundingCreditAttoEth.set(key, creditAttoEth - creditedAttoEth)
			reservedCostAttoEth += incrementalCostAttoEth
			accountedCanonicalSigners.add(key)
		},
		recordWalletTransaction: (costAttoEth: bigint) => {
			assertWithinBudget(costAttoEth)
			reservedCostAttoEth += costAttoEth
		},
	}
}

type DeploymentBudget = ReturnType<typeof createDeploymentBudget>

export function createBudgetedTransactionSender(wallet: BudgetedWallet, account: Account, limits: { budget?: DeploymentBudget; maxFeePerGas: bigint; maxTotalCost: bigint }) {
	const budget = limits.budget ?? createDeploymentBudget(limits.maxTotalCost)
	const sendTransaction: WriteClient['sendTransaction'] = async transaction => {
		const [nonce, gasPrice, block] = await Promise.all([wallet.getTransactionCount({ address: account.address, blockTag: 'pending' }), wallet.getGasPrice(), wallet.getBlock()])
		const baseFeePerGas = block.baseFeePerGas
		if (baseFeePerGas === undefined) throw new Error('Deployment transactions require an EIP-1559 base fee')
		if (baseFeePerGas > limits.maxFeePerGas) throw new Error(`Current base fee ${baseFeePerGas.toString()} attoETH per gas exceeds the authorized maximum ${limits.maxFeePerGas.toString()} attoETH per gas`)
		if (gasPrice > limits.maxFeePerGas) throw new Error(`RPC suggested gas price ${gasPrice.toString()} attoETH per gas exceeds the authorized maximum ${limits.maxFeePerGas.toString()} attoETH per gas`)
		const maxPriorityFeePerGas = gasPrice > baseFeePerGas ? gasPrice - baseFeePerGas : 0n
		const candidateMaxFeePerGas = baseFeePerGas * 2n + maxPriorityFeePerGas
		const maxFeePerGas = candidateMaxFeePerGas > limits.maxFeePerGas ? limits.maxFeePerGas : candidateMaxFeePerGas
		const gas = paddedGas(
			await wallet.estimateGas({
				account: account.address,
				data: transaction.data,
				maxFeePerGas,
				maxPriorityFeePerGas,
				to: transaction.to ?? undefined,
				value: transaction.value ?? transaction.amount,
			}),
		)
		const transactionValue = transaction.value ?? transaction.amount ?? 0n
		const worstCaseCost = gas * maxFeePerGas + transactionValue
		budget.recordWalletTransaction(worstCaseCost)
		const hash = await wallet.sendTransaction({
			...transaction,
			account,
			gas,
			gasPrice: undefined,
			maxFeePerGas,
			maxPriorityFeePerGas,
			nonce,
		})
		return hash
	}
	return sendTransaction
}

export function createPreparedDeploymentClient(parameters: { chain: Chain; maxFeePerGas?: bigint; maxTotalCost?: bigint; privateKey: Hex; rpcUrl: string }): WriteClient {
	const account = privateKeyToAccount(parameters.privateKey)
	const wallet = createWalletClient({
		account,
		chain: parameters.chain,
		transport: http(parameters.rpcUrl),
	})
	const maxTotalCost = parameters.maxTotalCost ?? parseMaxTotalCost(undefined)
	const budget = createDeploymentBudget(maxTotalCost)
	const sendTransaction = createBudgetedTransactionSender(wallet, account, {
		budget,
		maxFeePerGas: parameters.maxFeePerGas ?? parseMaxFeePerGas(undefined),
		maxTotalCost,
	})

	return {
		...wallet,
		assertCanonicalRawTransactionCost: budget.assertCanonicalRawTransactionCost,
		recordCanonicalFunding: budget.recordCanonicalFunding,
		recordCanonicalRawTransaction: budget.recordCanonicalRawTransaction,
		requiresWalletConfirmation: false,
		sendTransaction,
	}
}

export async function assertNoPendingDeployerTransactions(client: Pick<WriteClient, 'getTransactionCount'>, address: Address) {
	const [confirmedNonce, pendingNonce] = await Promise.all([client.getTransactionCount({ address, blockTag: 'latest' }), client.getTransactionCount({ address, blockTag: 'pending' })])
	if (pendingNonce !== confirmedNonce) throw new Error(`Deployer ${address} has pending transactions. Wait for them to settle, then retry.`)
}

export async function assertRequiredEvmCompatible(client: Pick<WriteClient, 'call'>, chainId: number) {
	let cancunResult: Awaited<ReturnType<WriteClient['call']>>
	try {
		cancunResult = await client.call({ data: CANCUN_CAPABILITY_PROBE })
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new Error(`RPC chain ${chainId.toString()} does not support the Cancun EVM opcodes required by Zoltar and Uniswap V4: ${reason}`)
	}
	if (cancunResult.data !== CANCUN_CAPABILITY_RESULT) throw new Error(`RPC chain ${chainId.toString()} returned an invalid Cancun EVM capability result`)
	let osakaResult: Awaited<ReturnType<WriteClient['call']>>
	try {
		osakaResult = await client.call({ data: OSAKA_CAPABILITY_PROBE })
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new Error(`RPC chain ${chainId.toString()} does not support the Osaka CLZ opcode required by the compiled Zoltar contracts: ${reason}`)
	}
	if (osakaResult.data !== OSAKA_CAPABILITY_RESULT) throw new Error(`RPC chain ${chainId.toString()} returned an invalid Osaka EVM capability result`)
}

export async function assertEip1559Compatible(client: Pick<WriteClient, 'getBlock'>, chainId: number) {
	const block = await client.getBlock()
	if (block.baseFeePerGas === undefined) throw new Error(`RPC chain ${chainId.toString()} does not expose the EIP-1559 base fee required for bounded deployment transactions`)
}

function hasCode(code: Hex | undefined): code is Hex {
	return code !== undefined && code !== '0x'
}

function getExpectedRuntimeCodeHash(id: string) {
	const hash = EXPECTED_RUNTIME_CODE_HASHES[id]
	if (hash === undefined) throw new Error(`Deployment step ${id} has no expected runtime code hash`)
	return hash
}

function assertExpectedRuntimeCode(id: string, address: Address, code: Hex | undefined, expectedRuntimeCodeHash: Hash) {
	if (!hasCode(code)) return false
	const actualRuntimeCodeHash = keccak256(code)
	if (actualRuntimeCodeHash !== expectedRuntimeCodeHash) throw new Error(`Unexpected runtime code for ${id} at ${address}: expected ${expectedRuntimeCodeHash}, received ${actualRuntimeCodeHash}`)
	return true
}

async function assertDeploymentPlanStepRuntimeCode<TClient>(step: DeploymentPlanStep<TClient>, client: TClient, code: Hex | undefined) {
	if (!hasCode(code)) return false
	if (step.verifyRuntimeCode !== undefined) {
		await step.verifyRuntimeCode(client, code)
		return true
	}
	if (step.expectedRuntimeCodeHash === undefined) throw new Error(`Deployment step ${step.id} has no runtime-code verifier`)
	return assertExpectedRuntimeCode(step.id, step.address, code, step.expectedRuntimeCodeHash)
}

export async function runDeploymentPlan<TClient extends CodeReader>(steps: readonly DeploymentPlanStep<TClient>[], client: TClient, log: (message: string) => void = console.log): Promise<DeploymentStepResult[]> {
	const completed = new Set<string>()
	const results: DeploymentStepResult[] = []
	for (const step of steps) {
		const missingDependency = step.dependencies.find(dependency => !completed.has(dependency))
		if (missingDependency !== undefined) throw new Error(`${step.label} requires incomplete deployment step ${missingDependency}`)
		if (await assertDeploymentPlanStepRuntimeCode(step, client, await client.getCode({ address: step.address }))) {
			completed.add(step.id)
			results.push({ address: step.address, id: step.id, label: step.label, status: 'skipped', transactionHash: undefined })
			log(`skip ${step.id} ${step.address}`)
			continue
		}

		log(`deploy ${step.id} ${step.address}`)
		const transactionHash = await step.deploy(client)
		const code = await client.getCode({ address: step.address })
		if (!hasCode(code)) throw new Error(`${step.label} deployment transaction ${transactionHash} succeeded without installing code at ${step.address}`)
		await assertDeploymentPlanStepRuntimeCode(step, client, code)
		completed.add(step.id)
		results.push({ address: step.address, id: step.id, label: step.label, status: 'deployed', transactionHash })
		log(`deployed ${step.id} ${transactionHash}`)
	}
	return results
}

async function assertProxyCode(client: CodeReader) {
	const code = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
	if (code === undefined || code === '0x') return
	if (code.toLowerCase() !== PROXY_DEPLOYER_RUNTIME_CODE.toLowerCase()) throw new Error(`Unexpected code at canonical proxy deployer ${PROXY_DEPLOYER_ADDRESS}`)
}

async function assertCanonicalCreate2DeployerCode(client: CodeReader) {
	const code = await client.getCode({ address: ARACHNID_CREATE2_DEPLOYER_ADDRESS })
	if (code === undefined || code === '0x') return
	if (code.toLowerCase() !== ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE.toLowerCase()) throw new Error(`Unexpected code at canonical CREATE2 deployer ${ARACHNID_CREATE2_DEPLOYER_ADDRESS}`)
}

export function createCompleteDeploymentPlan(profile: NetworkProfile, uniswap: UniswapDeployment) {
	const [create2DeployerStep, permit2Step, ...uniswapQuoteSteps] = uniswap.steps
	if (create2DeployerStep === undefined || create2DeployerStep.id !== 'arachnidCreate2Deployer') throw new Error('Uniswap deployment plan must begin with the canonical CREATE2 deployer')
	if (permit2Step === undefined || permit2Step.id !== 'permit2') throw new Error('Uniswap deployment plan must deploy Permit2 after the canonical CREATE2 deployer')
	const [proxyDeployerStep, ...protocolSteps] = getDeploymentSteps(profile)
	if (proxyDeployerStep === undefined || proxyDeployerStep.id !== 'proxyDeployer') throw new Error('Protocol deployment plan must begin with the canonical proxy deployer')
	const protocolStepsWithExternalDependencies = protocolSteps.map(step => (step.id === 'openOracle' ? { ...step, dependencies: [...step.dependencies, 'permit2'] } : step))
	return [create2DeployerStep, permit2Step, proxyDeployerStep, ...uniswapQuoteSteps, ...protocolStepsWithExternalDependencies].map(step => (!('verifyRuntimeCode' in step) || step.verifyRuntimeCode === undefined ? { ...step, expectedRuntimeCodeHash: getExpectedRuntimeCodeHash(step.id) } : step))
}

export async function assertBootstrapDescendantCode(client: CodeReader, profile: NetworkProfile) {
	const bootstrapDescendants = getBootstrapDescendantAddresses(profile)
	for (const [id, address] of Object.entries(bootstrapDescendants)) {
		const code = await client.getCode({ address })
		if (!hasCode(code)) throw new Error(`Bootstrap descendant ${id} is missing at ${address}`)
		assertExpectedRuntimeCode(id, address, code, getExpectedRuntimeCodeHash(id))
	}
	return bootstrapDescendants
}

async function writeGitHubSummary(chainId: number, account: Address, results: readonly DeploymentStepResult[]) {
	const summaryPath = process.env['GITHUB_STEP_SUMMARY']
	if (summaryPath === undefined || summaryPath === '') return
	const rows = results.map(result => `| ${result.label} | ${result.status} | \`${result.address}\` | ${result.transactionHash === undefined ? '—' : `\`${result.transactionHash}\``} |`).join('\n')
	await appendFile(summaryPath, `## Testnet deployment\n\nChain ID: \`${chainId.toString()}\`  \nDeployer: \`${account}\`\n\n| Contract | Result | Address | Transaction |\n| --- | --- | --- | --- |\n${rows}\n`)
}

export async function deployTestnet(parameters: { chainId: number; maxFeePerGas?: bigint; maxTotalCost?: bigint; privateKey: Hex; rpcUrl: string; log?: (message: string) => void }) {
	const chainId = parseChainId(parameters.chainId.toString())
	const rpcUrl = parseRpcUrl(parameters.rpcUrl)
	const uniswap = await getUniswapDeployment(SEPOLIA_NETWORK_PROFILE.wethAddress)
	const profile = createDeploymentProfile(chainId, rpcUrl, uniswap.addresses)
	const client = createPreparedDeploymentClient({
		chain: profile.chain,
		...(parameters.maxFeePerGas === undefined ? {} : { maxFeePerGas: parameters.maxFeePerGas }),
		...(parameters.maxTotalCost === undefined ? {} : { maxTotalCost: parameters.maxTotalCost }),
		privateKey: parameters.privateKey,
		rpcUrl,
	})
	const actualChainId = await client.getChainId()
	if (actualChainId !== chainId) throw new Error(`RPC chain mismatch: expected ${chainId.toString()}, received ${actualChainId.toString()}`)
	await assertRequiredEvmCompatible(client, chainId)
	await assertEip1559Compatible(client, chainId)
	await assertNoPendingDeployerTransactions(client, client.account.address)
	await assertCanonicalCreate2DeployerCode(client)
	await assertProxyCode(client)
	const authorizedMaxFeePerGas = parameters.maxFeePerGas ?? parseMaxFeePerGas(undefined)
	const [canonicalCreate2Code, proxyCode] = await Promise.all([client.getCode({ address: ARACHNID_CREATE2_DEPLOYER_ADDRESS }), client.getCode({ address: PROXY_DEPLOYER_ADDRESS })])
	if (authorizedMaxFeePerGas < CANONICAL_DEPLOYER_RAW_GAS_PRICE && (!hasCode(canonicalCreate2Code) || !hasCode(proxyCode))) {
		throw new Error(`MAX_FEE_PER_GAS_GWEI authorizes ${authorizedMaxFeePerGas.toString()} attoETH per gas, but missing canonical deployers require fixed ${CANONICAL_DEPLOYER_RAW_GAS_PRICE.toString()} attoETH per gas raw transactions`)
	}
	if (!hasCode(proxyCode)) {
		const activity = await getProxyDeployerActivity(client)
		if (activity.pending) throw new Error('The deterministic proxy deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
		await assertProxyCode(client)
		if (!hasCode(await client.getCode({ address: PROXY_DEPLOYER_ADDRESS }))) {
			if (activity.confirmedNonce !== 0n) throw new Error('The deterministic proxy deployer signer nonce has already been consumed, but the canonical proxy is missing')
			const fundingShortfall = await getProxyDeployerFundingShortfall(client)
			const balance = await client.getBalance({ address: client.account.address })
			if (balance < fundingShortfall) throw new Error(`Deployer ${client.account.address} needs at least ${formatEther(fundingShortfall)} ETH to finish funding the canonical proxy deployer signer`)
		}
	}

	const log = parameters.log ?? console.log
	log(`network chain=${chainId.toString()} deployer=${client.account.address}`)
	const results = await runDeploymentPlan(createCompleteDeploymentPlan(profile, uniswap), client, log)
	await assertProxyCode(client)
	const bootstrapDescendants = await assertBootstrapDescendantCode(client, profile)
	await writeGitHubSummary(chainId, client.account.address, results)
	return { account: client.account.address, proofVerifier: bootstrapDescendants.escalationGameProofVerifier, results }
}

function printHelp() {
	console.log(`Deploy the complete deterministic Zoltar infrastructure to an EVM testnet

PRIVATE_KEY=0x... RPC_URL=https://... bun run deploy:testnet -- [options]

  --rpc-url=https://...   Required unless RPC_URL is set
  --chain-id=11155111     Defaults to Sepolia chain ID 11155111
  --max-fee-per-gas-gwei=100  Rejects higher RPC fee suggestions
  --max-total-cost-eth=10     Caps worst-case fees and transaction value

Custom testnets receive the same deterministic WETH and genesis REP deployment
used by Sepolia. The RPC must support Cancun, EIP-1559, and the canonical
unprotected legacy deployer transactions. Ethereum mainnet chain ID 1 is
intentionally rejected.`)
}

async function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		printHelp()
		return
	}
	const rpcUrl = parseRpcUrl(option('rpc-url') ?? process.env['RPC_URL'])
	const chainId = parseChainId(option('chain-id') ?? process.env['CHAIN_ID'])
	const privateKey = parsePrivateKey(process.env['PRIVATE_KEY'])
	const maxFeePerGas = parseMaxFeePerGas(option('max-fee-per-gas-gwei') ?? process.env['MAX_FEE_PER_GAS_GWEI'])
	const maxTotalCost = parseMaxTotalCost(option('max-total-cost-eth') ?? process.env['MAX_TOTAL_COST_ETH'])
	await deployTestnet({ chainId, maxFeePerGas, maxTotalCost, privateKey, rpcUrl })
}

const currentScriptPath = url.fileURLToPath(import.meta.url)
const invokedScriptPath = process.argv[1]

if (invokedScriptPath !== undefined && path.resolve(invokedScriptPath) === currentScriptPath) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : error)
		process.exit(1)
	})
}
