#!/usr/bin/env bun

import { appendFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'
import { createWalletClient, defineChain, formatEther, http, privateKeyToAccount, type Address, type Chain, type Hash, type Hex } from '@zoltar/shared/ethereum'
import { getBootstrapDescendantAddresses } from '../ui/ts/protocol/deploymentHelpers.ts'
import { getDeploymentSteps, getProxyDeployerActivity, getProxyDeployerFundingShortfall, PROXY_DEPLOYER_RUNTIME_CODE } from '../ui/ts/protocol/deployment.ts'
import { PROXY_DEPLOYER_ADDRESS } from '../ui/ts/protocol/deploymentHelpers.ts'
import { SEPOLIA_NETWORK_PROFILE, type NetworkProfile } from '../ui/ts/lib/networkProfile.ts'
import type { WriteClient } from '../ui/ts/lib/chainBackend.ts'
import { ARACHNID_CREATE2_DEPLOYER_ADDRESS, ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE, getUniswapDeployment, type UniswapDeployment } from './uniswap-deployment.mts'

const DEFAULT_CHAIN_ID = 11_155_111
const CANCUN_CAPABILITY_PROBE = '0x6000600060005e600160005d60005c60005260206000f3'
const CANCUN_CAPABILITY_RESULT = '0x0000000000000000000000000000000000000000000000000000000000000001'

type DeploymentPlanStep<TClient> = {
	address: Address
	dependencies: readonly string[]
	deploy: (client: TClient) => Promise<Hash>
	id: string
	label: string
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

export function createPreparedDeploymentClient(parameters: { chain: Chain; privateKey: Hex; rpcUrl: string }): WriteClient {
	const account = privateKeyToAccount(parameters.privateKey)
	const wallet = createWalletClient({
		account,
		chain: parameters.chain,
		transport: http(parameters.rpcUrl),
	})
	const sendTransaction: WriteClient['sendTransaction'] = async transaction => {
		const nonce = await wallet.getTransactionCount({ address: account.address, blockTag: 'pending' })
		const gasPrice = await wallet.getGasPrice()
		const gas = paddedGas(
			await wallet.estimateGas({
				account: account.address,
				data: transaction.data,
				gasPrice,
				to: transaction.to ?? undefined,
				value: transaction.value ?? transaction.amount,
			}),
		)
		return await wallet.sendTransaction({
			...transaction,
			account,
			gas,
			gasPrice,
			nonce,
		})
	}

	return {
		...wallet,
		requiresWalletConfirmation: false,
		sendTransaction,
	}
}

export async function assertNoPendingDeployerTransactions(client: Pick<WriteClient, 'getTransactionCount'>, address: Address) {
	const [confirmedNonce, pendingNonce] = await Promise.all([client.getTransactionCount({ address, blockTag: 'latest' }), client.getTransactionCount({ address, blockTag: 'pending' })])
	if (pendingNonce !== confirmedNonce) throw new Error(`Deployer ${address} has pending transactions. Wait for them to settle, then retry.`)
}

export async function assertCancunCompatible(client: Pick<WriteClient, 'call'>, chainId: number) {
	let result: Awaited<ReturnType<WriteClient['call']>>
	try {
		result = await client.call({ data: CANCUN_CAPABILITY_PROBE })
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new Error(`RPC chain ${chainId.toString()} does not support the Cancun EVM opcodes required by Zoltar and Uniswap V4: ${reason}`)
	}
	if (result.data !== CANCUN_CAPABILITY_RESULT) throw new Error(`RPC chain ${chainId.toString()} returned an invalid Cancun EVM capability result`)
}

function hasCode(code: Hex | undefined) {
	return code !== undefined && code !== '0x'
}

export async function runDeploymentPlan<TClient extends CodeReader>(steps: readonly DeploymentPlanStep<TClient>[], client: TClient, log: (message: string) => void = console.log): Promise<DeploymentStepResult[]> {
	const completed = new Set<string>()
	const results: DeploymentStepResult[] = []
	for (const step of steps) {
		const missingDependency = step.dependencies.find(dependency => !completed.has(dependency))
		if (missingDependency !== undefined) throw new Error(`${step.label} requires incomplete deployment step ${missingDependency}`)
		if (hasCode(await client.getCode({ address: step.address }))) {
			completed.add(step.id)
			results.push({ address: step.address, id: step.id, label: step.label, status: 'skipped', transactionHash: undefined })
			log(`skip ${step.id} ${step.address}`)
			continue
		}

		log(`deploy ${step.id} ${step.address}`)
		const transactionHash = await step.deploy(client)
		if (!hasCode(await client.getCode({ address: step.address }))) throw new Error(`${step.label} deployment transaction ${transactionHash} succeeded without installing code at ${step.address}`)
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
	return [create2DeployerStep, permit2Step, proxyDeployerStep, ...uniswapQuoteSteps, ...protocolStepsWithExternalDependencies]
}

async function writeGitHubSummary(chainId: number, account: Address, results: readonly DeploymentStepResult[]) {
	const summaryPath = process.env['GITHUB_STEP_SUMMARY']
	if (summaryPath === undefined || summaryPath === '') return
	const rows = results.map(result => `| ${result.label} | ${result.status} | \`${result.address}\` | ${result.transactionHash === undefined ? '—' : `\`${result.transactionHash}\``} |`).join('\n')
	await appendFile(summaryPath, `## Testnet deployment\n\nChain ID: \`${chainId.toString()}\`  \nDeployer: \`${account}\`\n\n| Contract | Result | Address | Transaction |\n| --- | --- | --- | --- |\n${rows}\n`)
}

export async function deployTestnet(parameters: { chainId: number; privateKey: Hex; rpcUrl: string; log?: (message: string) => void }) {
	const chainId = parseChainId(parameters.chainId.toString())
	const rpcUrl = parseRpcUrl(parameters.rpcUrl)
	const uniswap = await getUniswapDeployment(SEPOLIA_NETWORK_PROFILE.wethAddress)
	const profile = createDeploymentProfile(chainId, rpcUrl, uniswap.addresses)
	const client = createPreparedDeploymentClient({ chain: profile.chain, privateKey: parameters.privateKey, rpcUrl })
	const actualChainId = await client.getChainId()
	if (actualChainId !== chainId) throw new Error(`RPC chain mismatch: expected ${chainId.toString()}, received ${actualChainId.toString()}`)
	await assertCancunCompatible(client, chainId)
	await assertNoPendingDeployerTransactions(client, client.account.address)
	await assertCanonicalCreate2DeployerCode(client)
	await assertProxyCode(client)
	if (!hasCode(await client.getCode({ address: PROXY_DEPLOYER_ADDRESS }))) {
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
	const bootstrapDescendants = getBootstrapDescendantAddresses(profile)
	for (const [id, address] of Object.entries(bootstrapDescendants)) {
		if (!hasCode(await client.getCode({ address }))) throw new Error(`Bootstrap descendant ${id} is missing at ${address}`)
	}
	await writeGitHubSummary(chainId, client.account.address, results)
	return { account: client.account.address, proofVerifier: bootstrapDescendants.escalationGameProofVerifier, results }
}

function printHelp() {
	console.log(`Deploy the complete deterministic Zoltar infrastructure to an EVM testnet

PRIVATE_KEY=0x... RPC_URL=https://... bun run deploy:testnet -- [options]

  --rpc-url=https://...   Required unless RPC_URL is set
  --chain-id=11155111     Defaults to Sepolia chain ID 11155111

Custom testnets receive the same deterministic WETH and genesis REP deployment
used by Sepolia. The RPC must support the Cancun EVM hardfork. Ethereum mainnet
chain ID 1 is intentionally rejected.`)
}

async function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		printHelp()
		return
	}
	const rpcUrl = parseRpcUrl(option('rpc-url') ?? process.env['RPC_URL'])
	const chainId = parseChainId(option('chain-id') ?? process.env['CHAIN_ID'])
	const privateKey = parsePrivateKey(process.env['PRIVATE_KEY'])
	await deployTestnet({ chainId, privateKey, rpcUrl })
}

const currentScriptPath = url.fileURLToPath(import.meta.url)
const invokedScriptPath = process.argv[1]

if (invokedScriptPath !== undefined && path.resolve(invokedScriptPath) === currentScriptPath) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : error)
		process.exit(1)
	})
}
