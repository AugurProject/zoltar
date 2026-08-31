#!/usr/bin/env bun

import { appendFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'
import { createWalletClient, defineChain, formatEther, http, keccak256, parseUnits, privateKeyToAccount, type Account, type Address, type Chain, type Hash, type Hex } from '@zoltar/shared/ethereum'
import { getBootstrapDescendantAddresses } from '../ui/zoltar/ts/protocol/deploymentHelpers.ts'
import { assertStaticDeploymentArtifactRuntimeCodeHashes, CANONICAL_DEPLOYER_RAW_GAS_PRICE, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST, EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES, getProxyDeployerActivity, getProxyDeployerFundingShortfall, PROXY_DEPLOYER_RUNTIME_CODE } from '../ui/zoltar/ts/protocol/deployment.ts'
import { getDeploymentSteps } from '../ui/statoblast/ts/protocol/deployment.ts'
import { PROXY_DEPLOYER_ADDRESS } from '../ui/zoltar/ts/protocol/deploymentHelpers.ts'
import { SEPOLIA_NETWORK_PROFILE, type NetworkProfile } from '../ui/coreShared/ts/lib/networkProfile.ts'
import type { WriteClient } from '../ui/coreShared/ts/lib/chainBackend.ts'
import { readWithRpcStateRetries, type RpcStateRetryWait } from '../ui/zoltar/ts/protocol/core.ts'
import { ARACHNID_CREATE2_DEPLOYER_ADDRESS, ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE, getUniswapDeployment, resolveCanonicalCreate2DeployerForPreflight, type UniswapDeployment } from './uniswap-deployment.mts'

const DEFAULT_CHAIN_ID = 11_155_111
export const DEFAULT_MAX_FEE_PER_GAS_GWEI = '100'
export const DEFAULT_MAX_TOTAL_COST_ETH = '20'
export const DEPLOYMENT_RECEIPT_TIMEOUT_MILLISECONDS = 60 * 60 * 1_000
const CANCUN_CAPABILITY_PROBE = '0x6000600060005e600160005d60005c60005260206000f3'
const CANCUN_CAPABILITY_RESULT = '0x0000000000000000000000000000000000000000000000000000000000000001'
const OSAKA_CAPABILITY_PROBE = '0x5f1e60005260206000f3'
const OSAKA_CAPABILITY_RESULT = '0x0000000000000000000000000000000000000000000000000000000000000100'
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hash
const MAX_SIGNABLE_TRANSACTION_GAS = 16_777_216n
// These per-step ceilings are based on fresh Osaka Anvil deployments, increased
// by roughly 50%, rounded upward, and capped only where the signer itself caps a
// transaction at the Osaka 2^24 gas limit. Canonical deployer entries cover
// their optional atomic funding transaction; its fixed raw-transaction cost is
// added separately.
export const CONSERVATIVE_DEPLOYMENT_GAS: Readonly<Record<string, bigint>> = {
	arachnidCreate2Deployer: 500_000n,
	permit2: 3_250_000n,
	proxyDeployer: 500_000n,
	uniswapV3Factory: 8_500_000n,
	uniswapV3Quoter: 3_000_000n,
	uniswapV3SwapRouter: 4_250_000n,
	uniswapV4PoolManager: 8_000_000n,
	uniswapV4Quoter: 2_250_000n,
	deploymentStatusOracle: 1_000_000n,
	weth: 1_000_000n,
	reputationToken: 1_250_000n,
	multicall3: 1_250_000n,
	uniformPriceDualCapBatchAuctionFactory: 4_750_000n,
	scalarOutcomes: 250_000n,
	securityPoolUtils: 2_000_000n,
	openOracle: 4_250_000n,
	zoltarQuestionData: 2_750_000n,
	zoltar: 4_250_000n,
	shareTokenFactory: 5_500_000n,
	priceOracleManagerAndOperatorQueuerFactory: 12_250_000n,
	securityPoolForker: 16_250_000n,
	escalationGameClaimDelegate: 1_250_000n,
	escalationGameFactory: 14_250_000n,
	securityPoolFactory: 14_750_000n,
}
const CANONICAL_DEPLOYER_STEP_IDS = new Set(['arachnidCreate2Deployer', 'proxyDeployer'])
const EXPECTED_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	...EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES,
	arachnidCreate2Deployer: '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989',
	uniswapV3Factory: '0x6377aa1b105d3ee2a54d73d3652812d6209ca56871954f61ad6e87d9c184fa5e',
	uniswapV3Quoter: '0x8410f80f6ddf60c46fe39dc3394f3b245c16d62d1c401f4ebc2d030afbb1a264',
	uniswapV3SwapRouter: '0xf552d94a11865ed5100a536873ca827262cd361e489af067f4759a899833b5f5',
	uniswapV4PoolManager: '0xa761717f06c9ace7b3599d9a5fe795c17ef062a378d317d562f2aea4d52d2c49',
	uniswapV4Quoter: '0x988a8710947628ebe53e490c56f534703e45cf6d31c9707d8e0288d9ff65623b',
}

const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<'mainnet' | 'sepolia', Readonly<Record<string, Hash>>>> = {
	sepolia: {
		escalationGameCreationCodePartOne: '0xa5fd2dfefe573b8f87769bcfec9bcf54d2a2419e25d5d35b31c319f3a448dabf',
		escalationGameCreationCodePartTwo: '0x1fbb7128ea81343de00a04feaae84f7ca74538c91bdd6e1cd64800889c878b83',
		escalationGameProofVerifier: '0xfc49238fed42490497fb4e8674a8c246e50c23e3ab87bf87b5f1d0f7e4a4393a',
		liquidationApprovalRegistryDeployer: '0xdf8d31c4c3a7fd67763b61c9cf8a26dd494b3c4c632b02d2441ab3b7fdbd0f86',
		liquidationApprovalRegistryImplementation: '0x3627fef43fff4635e4ed78d5499bc1d7ac142e00bec7514272a699416b1933d8',
		priceCoordinatorCreationCodeFirstChunk: '0xb2d923d6091e5526573d9c740a0442c01fe608239077cc132d174e7a1e23ae78',
		priceCoordinatorCreationCodeSecondChunk: '0x31600fba62534dc98d7af851bd88fe79105b904dba03585d9cacc9cae3bda8b4',
		priceCoordinatorDeploymentWorker: '0xc7d9eff4511ad136ef6642e6de8dfdbc333478bdd1fe05c2e78004e7690d0500',
		securityPoolDeployer: '0x7d5f7bf6a961b060d3369fb65f9920a916c8880008039831b4ef4bc6c8a0bd8c',
		securityPoolDeploymentWorker: '0xfe4ba0cf0d3a6af73a8e22dc60164cbc4c6d434497da4a6aacd6b881cf537d64',
		securityPoolCreationCodeFirstChunk: '0xe4a175811b511d266ec66baecbc9c9fda81173fb5cdf538c12eca82e26cefcf1',
		securityPoolCreationCodeSecondChunk: '0x3ad6977c41c2e88c97d4f7c1de350b06f5f68c5bc03041fd718ac3761be1a4cb',
		securityPoolEventEmitter: '0xc534a6454451a2194188b0b2685d0e8c33c4f163601be6c1a5061a9165e90269',
		securityPoolForkerEscalationGameForkerDelegate: '0x821561de2cbf2792106db1bed6b27c8178713b8ff1b1b75585bdcc6508a2548f',
		securityPoolForkerEventEmitter: '0xc534a6454451a2194188b0b2685d0e8c33c4f163601be6c1a5061a9165e90269',
		securityPoolForkerVaultMigrationDelegate: '0x6680866ef249d9b6bdd97c997c76ac06dff2b43cd9466a918a0a46f8e97d18bc',
	},
	mainnet: {
		escalationGameCreationCodePartOne: '0xa5fd2dfefe573b8f87769bcfec9bcf54d2a2419e25d5d35b31c319f3a448dabf',
		escalationGameCreationCodePartTwo: '0x1fbb7128ea81343de00a04feaae84f7ca74538c91bdd6e1cd64800889c878b83',
		escalationGameProofVerifier: '0xfc49238fed42490497fb4e8674a8c246e50c23e3ab87bf87b5f1d0f7e4a4393a',
		liquidationApprovalRegistryDeployer: '0x4dc7e011fb5e889196605329cc61e25a44971232db0d9d58a1340a3aa18fa36d',
		liquidationApprovalRegistryImplementation: '0x3627fef43fff4635e4ed78d5499bc1d7ac142e00bec7514272a699416b1933d8',
		priceCoordinatorCreationCodeFirstChunk: '0xb2d923d6091e5526573d9c740a0442c01fe608239077cc132d174e7a1e23ae78',
		priceCoordinatorCreationCodeSecondChunk: '0x31600fba62534dc98d7af851bd88fe79105b904dba03585d9cacc9cae3bda8b4',
		priceCoordinatorDeploymentWorker: '0xd360771cdeb4b775d39d311964b5b1a5485f7c2c59394f874caa6135799ea4cd',
		securityPoolDeployer: '0x750d1744fb322d96dd4261b23d7afdb972a0ee1b3874302cdf295d10af74fb71',
		securityPoolDeploymentWorker: '0x0e5ea8bec88c0e80086f50b541b0cfe2e41e2c9cc1c8621730ae51f3889424a8',
		securityPoolCreationCodeFirstChunk: '0xe4a175811b511d266ec66baecbc9c9fda81173fb5cdf538c12eca82e26cefcf1',
		securityPoolCreationCodeSecondChunk: '0x3ad6977c41c2e88c97d4f7c1de350b06f5f68c5bc03041fd718ac3761be1a4cb',
		securityPoolEventEmitter: '0xc534a6454451a2194188b0b2685d0e8c33c4f163601be6c1a5061a9165e90269',
		securityPoolForkerEscalationGameForkerDelegate: '0x8f0a2144a20fae3267a272b055ff051451e2c3051e50942deee37f51a0c411cc',
		securityPoolForkerEventEmitter: '0xc534a6454451a2194188b0b2685d0e8c33c4f163601be6c1a5061a9165e90269',
		securityPoolForkerVaultMigrationDelegate: '0x3afc203cacb117fbfe5ac047a2aa11f692ef50cc78d64c031a8605f46b23e6f2',
	},
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

function formatDeploymentLogBranch(title: string, fields: readonly (readonly [label: string, value: string])[]) {
	const lines = [`  ├─ ${title}`]
	for (const [index, [label, value]] of fields.entries()) {
		const connector = index === fields.length - 1 ? '└─' : '├─'
		lines.push(`  │  ${connector} ${label}: ${value}`)
	}
	return lines.join('\n')
}

function formatLogSection(title: string, fields: readonly (readonly [label: string, value: string])[]) {
	const lines = [title]
	for (const [index, [label, value]] of fields.entries()) {
		const connector = index === fields.length - 1 ? '└─' : '├─'
		lines.push(`  ${connector} ${label}: ${value}`)
	}
	return lines.join('\n')
}

function option(name: string, argv = process.argv.slice(2)) {
	const prefix = `--${name}=`
	return argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
}

function assignment(name: string, argv: readonly string[]) {
	const prefixes = [`${name}=`, `--${name}=`]
	for (const argument of argv) {
		const prefix = prefixes.find(candidate => argument.startsWith(candidate))
		if (prefix !== undefined) return argument.slice(prefix.length)
	}
	return undefined
}

function commandLineValue(optionName: string, assignmentName: string, argv: readonly string[]) {
	return option(optionName, [...argv]) ?? assignment(assignmentName, argv)
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
	if (!isPrivateKey(value)) throw new Error('PRIVATE_KEY or --private-key must be a 32-byte 0x-prefixed private key')
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

export function parseDeploymentCommandLine(argv = process.argv.slice(2), environment: Readonly<Record<string, string | undefined>> = process.env) {
	return {
		chainId: parseChainId(commandLineValue('chain-id', 'CHAIN_ID', argv) ?? environment['CHAIN_ID']),
		maxFeePerGas: parseMaxFeePerGas(commandLineValue('max-fee-per-gas-gwei', 'MAX_FEE_PER_GAS_GWEI', argv) ?? environment['MAX_FEE_PER_GAS_GWEI']),
		maxTotalCost: parseMaxTotalCost(commandLineValue('max-total-cost-eth', 'MAX_TOTAL_COST_ETH', argv) ?? environment['MAX_TOTAL_COST_ETH']),
		privateKey: parsePrivateKey(option('private-key', [...argv]) ?? environment['PRIVATE_KEY']),
		rpcUrl: parseRpcUrl(commandLineValue('rpc-url', 'RPC_URL', argv) ?? environment['RPC_URL']),
	}
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
	if (gasEstimate > MAX_SIGNABLE_TRANSACTION_GAS) throw new Error(`Estimated deployment gas ${gasEstimate.toString()} exceeds the transaction signer limit ${MAX_SIGNABLE_TRANSACTION_GAS.toString()}`)
	const padded = gasEstimate + gasEstimate / 5n + 10_000n
	return padded > MAX_SIGNABLE_TRANSACTION_GAS ? MAX_SIGNABLE_TRANSACTION_GAS : padded
}

type BudgetedWallet = Pick<WriteClient, 'call' | 'estimateGas' | 'getBlock' | 'getGasPrice' | 'getTransactionCount' | 'sendTransaction'>

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

export function createBudgetedTransactionSender(wallet: BudgetedWallet, account: Account, limits: { budget?: DeploymentBudget; maxFeePerGas: bigint; maxTotalCost: bigint }, log: (message: string) => void = () => undefined) {
	const budget = limits.budget ?? createDeploymentBudget(limits.maxTotalCost)
	const sendTransaction: WriteClient['sendTransaction'] = async transaction => {
		log(formatDeploymentLogBranch('Prepare transaction', [['Account', account.address]]))
		const [nonce, gasPrice, block] = await Promise.all([wallet.getTransactionCount({ address: account.address, blockTag: 'pending' }), wallet.getGasPrice(), wallet.getBlock()])
		const baseFeePerGas = block.baseFeePerGas
		if (baseFeePerGas === undefined) throw new Error('Deployment transactions require an EIP-1559 base fee')
		if (baseFeePerGas > limits.maxFeePerGas) throw new Error(`Current base fee ${baseFeePerGas.toString()} attoETH per gas exceeds the authorized maximum ${limits.maxFeePerGas.toString()} attoETH per gas`)
		if (gasPrice > limits.maxFeePerGas) throw new Error(`RPC suggested gas price ${gasPrice.toString()} attoETH per gas exceeds the authorized maximum ${limits.maxFeePerGas.toString()} attoETH per gas`)
		const maxPriorityFeePerGas = gasPrice > baseFeePerGas ? gasPrice - baseFeePerGas : 0n
		const candidateMaxFeePerGas = baseFeePerGas * 2n + maxPriorityFeePerGas
		const maxFeePerGas = candidateMaxFeePerGas > limits.maxFeePerGas ? limits.maxFeePerGas : candidateMaxFeePerGas
		log(
			formatDeploymentLogBranch('Estimate transaction', [
				['Nonce', nonce.toString()],
				['Base fee', `${formatEther(baseFeePerGas * 1_000_000_000n)} gwei`],
				['Priority fee', `${formatEther(maxPriorityFeePerGas * 1_000_000_000n)} gwei`],
				['Maximum fee', `${formatEther(maxFeePerGas * 1_000_000_000n)} gwei`],
			]),
		)
		const estimationRequest = {
			account: account.address,
			data: transaction.data,
			maxFeePerGas,
			maxPriorityFeePerGas,
			to: transaction.to ?? undefined,
			value: transaction.value ?? transaction.amount,
		}
		let gasEstimate: bigint | undefined
		try {
			gasEstimate = await wallet.estimateGas(estimationRequest)
		} catch (estimateError) {
			// CREATE/CREATE2 proxies can turn an inner out-of-gas during an RPC
			// estimator's binary search into an indistinguishable empty revert.
			try {
				await wallet.call({ ...estimationRequest, gas: MAX_SIGNABLE_TRANSACTION_GAS })
			} catch (simulationError) {
				const simulationReason = simulationError instanceof Error ? simulationError.message : String(simulationError)
				const estimateReason = estimateError instanceof Error ? estimateError.message : String(estimateError)
				throw new Error(`Gas estimation failed (${estimateReason}) and the ${MAX_SIGNABLE_TRANSACTION_GAS.toString()} gas fallback simulation also failed (${simulationReason})`, { cause: estimateError })
			}
			log(
				formatDeploymentLogBranch('Gas estimate unavailable', [
					['Fallback gas limit', MAX_SIGNABLE_TRANSACTION_GAS.toString()],
					['Validation', 'capped simulation succeeded'],
				]),
			)
		}
		const gas = gasEstimate === undefined ? MAX_SIGNABLE_TRANSACTION_GAS : paddedGas(gasEstimate)
		const transactionValue = transaction.value ?? transaction.amount ?? 0n
		const worstCaseCost = gas * maxFeePerGas + transactionValue
		budget.recordWalletTransaction(worstCaseCost)
		log(
			formatDeploymentLogBranch('Submit transaction', [
				['Nonce', nonce.toString()],
				['To', transaction.to ?? 'contract creation'],
				['Gas limit', gas.toString()],
				['Value', `${formatEther(transactionValue)} ETH`],
				['Maximum cost', `${formatEther(worstCaseCost)} ETH`],
			]),
		)
		const hash = await wallet.sendTransaction({
			...transaction,
			account,
			gas,
			gasPrice: undefined,
			maxFeePerGas,
			maxPriorityFeePerGas,
			nonce,
		})
		log(
			formatDeploymentLogBranch('Transaction submitted', [
				['Nonce', nonce.toString()],
				['Transaction', hash],
			]),
		)
		return hash
	}
	return sendTransaction
}

export function createDeploymentReceiptWaiter(client: Pick<WriteClient, 'waitForTransactionReceipt'>, log: (message: string) => void = () => undefined) {
	const waitForTransactionReceipt: WriteClient['waitForTransactionReceipt'] = async parameters => {
		const timeout = parameters.timeout ?? DEPLOYMENT_RECEIPT_TIMEOUT_MILLISECONDS
		log(
			formatDeploymentLogBranch('Wait for receipt', [
				['Transaction', parameters.hash],
				['Timeout', `${(timeout / 1_000).toString()}s`],
			]),
		)
		const receipt = await client.waitForTransactionReceipt({
			...parameters,
			timeout,
		})
		log(
			formatDeploymentLogBranch('Receipt confirmed', [
				['Transaction', receipt.transactionHash],
				['Status', receipt.status],
				['Block', receipt.blockNumber.toString()],
				['Gas used', receipt.gasUsed.toString()],
			]),
		)
		return receipt
	}
	return waitForTransactionReceipt
}

export function createPreparedDeploymentClient(parameters: { chain: Chain; log?: (message: string) => void; maxFeePerGas?: bigint; maxTotalCost?: bigint; privateKey: Hex; rpcUrl: string }): WriteClient {
	const account = privateKeyToAccount(parameters.privateKey)
	const wallet = createWalletClient({
		account,
		chain: parameters.chain,
		transport: http(parameters.rpcUrl),
	})
	const maxTotalCost = parameters.maxTotalCost ?? parseMaxTotalCost(undefined)
	const budget = createDeploymentBudget(maxTotalCost)
	const sendTransaction = createBudgetedTransactionSender(
		wallet,
		account,
		{
			budget,
			maxFeePerGas: parameters.maxFeePerGas ?? parseMaxFeePerGas(undefined),
			maxTotalCost,
		},
		parameters.log,
	)
	const waitForTransactionReceipt = createDeploymentReceiptWaiter(wallet, parameters.log)

	return {
		...wallet,
		assertCanonicalRawTransactionCost: budget.assertCanonicalRawTransactionCost,
		recordCanonicalFunding: budget.recordCanonicalFunding,
		recordCanonicalRawTransaction: budget.recordCanonicalRawTransaction,
		requiresWalletConfirmation: false,
		sendTransaction,
		waitForTransactionReceipt,
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

export async function runDeploymentPlan<TClient extends CodeReader>(steps: readonly DeploymentPlanStep<TClient>[], client: TClient, log: (message: string) => void = console.log, wait?: RpcStateRetryWait, knownInstalledAddresses: ReadonlySet<Address> = new Set()): Promise<DeploymentStepResult[]> {
	const completed = new Set<string>()
	const results: DeploymentStepResult[] = []
	for (const step of steps) {
		const missingDependency = step.dependencies.find(dependency => !completed.has(dependency))
		if (missingDependency !== undefined) throw new Error(`${step.label} requires incomplete deployment step ${missingDependency}`)
		if (knownInstalledAddresses.has(step.address) || (await assertDeploymentPlanStepRuntimeCode(step, client, await client.getCode({ address: step.address })))) {
			completed.add(step.id)
			results.push({ address: step.address, id: step.id, label: step.label, status: 'skipped', transactionHash: undefined })
			log(
				formatLogSection(`${step.label} (${step.id})`, [
					['Address', step.address],
					['Status', 'already deployed'],
				]),
			)
			continue
		}

		log(`${step.label} (${step.id})\n  ├─ Address: ${step.address}`)
		try {
			const transactionHash = await step.deploy(client)
			const code = await readWithRpcStateRetries(() => client.getCode({ address: step.address }), hasCode, wait)
			if (!hasCode(code)) throw new Error(`${step.label} deployment transaction ${transactionHash} succeeded without installing code at ${step.address}`)
			await assertDeploymentPlanStepRuntimeCode(step, client, code)
			completed.add(step.id)
			if (transactionHash === ZERO_HASH) {
				results.push({ address: step.address, id: step.id, label: step.label, status: 'skipped', transactionHash: undefined })
				log('  └─ Status: ready (installed without a submitted transaction)')
				continue
			}
			results.push({ address: step.address, id: step.id, label: step.label, status: 'deployed', transactionHash })
			log(`  ├─ Transaction: ${transactionHash}\n  └─ Status: deployed`)
		} catch (error) {
			log('  └─ Status: failed')
			throw error
		}
	}
	return results
}

export async function preflightDeploymentPlan<TClient extends CodeReader>(steps: readonly DeploymentPlanStep<TClient>[], client: TClient, gasAllowances: Readonly<Record<string, bigint>>, maxFeePerGas: bigint, maxTotalCost: bigint, knownInstalledAddresses: ReadonlySet<Address> = new Set()) {
	const completed = new Set<string>()
	const missingStepIds: string[] = []
	let estimatedGas = 0n
	let estimatedCostAttoEth = 0n
	for (const step of steps) {
		const missingDependency = step.dependencies.find(dependency => !completed.has(dependency))
		if (missingDependency !== undefined) throw new Error(`${step.label} requires incomplete deployment step ${missingDependency}`)
		const installed = knownInstalledAddresses.has(step.address) || (await assertDeploymentPlanStepRuntimeCode(step, client, await client.getCode({ address: step.address })))
		completed.add(step.id)
		if (installed) continue
		const gasAllowance = gasAllowances[step.id]
		if (gasAllowance === undefined) throw new Error(`Deployment step ${step.id} has no conservative gas allowance`)
		if (gasAllowance <= 0n) throw new Error(`Deployment step ${step.id} has an invalid conservative gas allowance`)
		missingStepIds.push(step.id)
		estimatedGas += gasAllowance
		estimatedCostAttoEth += gasAllowance * maxFeePerGas
		if (CANONICAL_DEPLOYER_STEP_IDS.has(step.id)) estimatedCostAttoEth += CANONICAL_DEPLOYER_RAW_TRANSACTION_COST
	}
	if (estimatedCostAttoEth > maxTotalCost) {
		throw new Error(`Deployment preflight estimated upper-bound cost ${formatEther(estimatedCostAttoEth)} ETH for ${missingStepIds.length.toString()} missing steps, above MAX_TOTAL_COST_ETH ${formatEther(maxTotalCost)}; no funding or deployment transaction was attempted`)
	}
	return { estimatedCostAttoEth, estimatedGas, missingStepIds }
}

async function assertProxyCode(client: CodeReader) {
	const code = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
	if (code === undefined || code === '0x') return
	if (code.toLowerCase() !== PROXY_DEPLOYER_RUNTIME_CODE.toLowerCase()) throw new Error(`Unexpected code at canonical proxy deployer ${PROXY_DEPLOYER_ADDRESS}`)
}

export async function assertConfirmedProxyCode(client: CodeReader, wait?: RpcStateRetryWait) {
	const code = await readWithRpcStateRetries(() => client.getCode({ address: PROXY_DEPLOYER_ADDRESS }), hasCode, wait)
	if (!hasCode(code)) throw new Error('The deterministic proxy deployer signer nonce has already been consumed, but the canonical proxy is missing')
	if (code.toLowerCase() !== PROXY_DEPLOYER_RUNTIME_CODE.toLowerCase()) throw new Error(`Unexpected code at canonical proxy deployer ${PROXY_DEPLOYER_ADDRESS}`)
}

export async function resolveCanonicalProxyDeployerForPreflight(client: CodeReader & Pick<WriteClient, 'getBalance' | 'getTransactionCount'>, wait?: RpcStateRetryWait) {
	const code = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
	if (hasCode(code)) {
		if (code.toLowerCase() !== PROXY_DEPLOYER_RUNTIME_CODE.toLowerCase()) throw new Error(`Unexpected code at canonical proxy deployer ${PROXY_DEPLOYER_ADDRESS}`)
		return true
	}
	const activity = await getProxyDeployerActivity(client)
	if (activity.confirmedNonce === 0n) return false
	await assertConfirmedProxyCode(client, wait)
	return true
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

export async function assertBootstrapDescendantCode(client: CodeReader, profile: NetworkProfile, wait?: RpcStateRetryWait, expectedRuntimeCodeHashes?: Readonly<Record<string, Hash>>) {
	const bootstrapDescendants = getBootstrapDescendantAddresses(profile)
	if (profile.id === 'simulation') throw new Error('Exact bootstrap descendant runtime-code verification is unavailable for simulation')
	const resolvedExpectedRuntimeCodeHashes = expectedRuntimeCodeHashes ?? EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES[profile.id]
	const entries = Object.entries(bootstrapDescendants)
	const codes = await readWithRpcStateRetries(
		async () => {
			const currentCodes = await Promise.all(entries.map(async ([, address]) => await client.getCode({ address })))
			for (const [index, [id, address]] of entries.entries()) {
				const code = currentCodes[index]
				if (!hasCode(code)) continue
				const expectedRuntimeCodeHash = resolvedExpectedRuntimeCodeHashes[id]
				if (expectedRuntimeCodeHash === undefined) throw new Error(`Bootstrap descendant ${id} has no expected runtime code hash for ${profile.id}`)
				assertExpectedRuntimeCode(id, address, code, expectedRuntimeCodeHash)
			}
			return currentCodes
		},
		currentCodes => currentCodes.every(hasCode),
		wait,
	)
	for (const [index, [id, address]] of entries.entries()) {
		const code = codes[index]
		if (!hasCode(code)) throw new Error(`Bootstrap descendant ${id} is missing at ${address}`)
	}
	return bootstrapDescendants
}

async function writeGitHubSummary(chainId: number, account: Address, results: readonly DeploymentStepResult[]) {
	const summaryPath = process.env['GITHUB_STEP_SUMMARY']
	if (summaryPath === undefined || summaryPath === '') return
	const rows = results.map(result => `| ${result.label} | ${result.status} | \`${result.address}\` | ${result.transactionHash === undefined ? '—' : `\`${result.transactionHash}\``} |`).join('\n')
	await appendFile(summaryPath, `## Testnet deployment\n\nChain ID: \`${chainId.toString()}\`  \nDeployer: \`${account}\`\n\n| Contract | Result | Address | Transaction |\n| --- | --- | --- | --- |\n${rows}\n`)
}

export async function deployTestnet(parameters: { chainId: number; maxFeePerGas?: bigint; maxTotalCost?: bigint; privateKey: Hex; rpcUrl: string; log?: (message: string) => void; writeGitHubSummary?: boolean }) {
	assertStaticDeploymentArtifactRuntimeCodeHashes()
	const chainId = parseChainId(parameters.chainId.toString())
	const rpcUrl = parseRpcUrl(parameters.rpcUrl)
	const log = parameters.log ?? console.log
	const uniswap = await getUniswapDeployment(SEPOLIA_NETWORK_PROFILE.wethAddress)
	const profile = createDeploymentProfile(chainId, rpcUrl, uniswap.addresses)
	const client = createPreparedDeploymentClient({
		chain: profile.chain,
		log,
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
	const authorizedMaxTotalCost = parameters.maxTotalCost ?? parseMaxTotalCost(undefined)
	const canonicalCreate2Installed = await resolveCanonicalCreate2DeployerForPreflight(client)
	const proxyInstalled = await resolveCanonicalProxyDeployerForPreflight(client)
	if (authorizedMaxFeePerGas < CANONICAL_DEPLOYER_RAW_GAS_PRICE && (!canonicalCreate2Installed || !proxyInstalled)) {
		throw new Error(`MAX_FEE_PER_GAS_GWEI authorizes ${authorizedMaxFeePerGas.toString()} attoETH per gas, but missing canonical deployers require fixed ${CANONICAL_DEPLOYER_RAW_GAS_PRICE.toString()} attoETH per gas raw transactions`)
	}
	const plan = createCompleteDeploymentPlan(profile, uniswap)
	const knownInstalledAddresses = new Set<Address>()
	if (canonicalCreate2Installed) knownInstalledAddresses.add(ARACHNID_CREATE2_DEPLOYER_ADDRESS)
	if (proxyInstalled) knownInstalledAddresses.add(PROXY_DEPLOYER_ADDRESS)
	const estimate = await preflightDeploymentPlan(plan, client, CONSERVATIVE_DEPLOYMENT_GAS, authorizedMaxFeePerGas, authorizedMaxTotalCost, knownInstalledAddresses)
	log(
		formatLogSection('Preflight', [
			['Missing contracts', estimate.missingStepIds.length.toString()],
			['Estimated maximum cost', `${formatEther(estimate.estimatedCostAttoEth)} ETH`],
			['Authorized total', `${formatEther(authorizedMaxTotalCost)} ETH`],
			['Fee ceiling', `${formatEther(authorizedMaxFeePerGas * 1_000_000_000n)} gwei`],
		]),
	)
	if (!proxyInstalled) {
		const activity = await getProxyDeployerActivity(client)
		if (activity.pending) throw new Error('The deterministic proxy deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
		await assertProxyCode(client)
		if (!hasCode(await client.getCode({ address: PROXY_DEPLOYER_ADDRESS }))) {
			if (activity.confirmedNonce !== 0n) await assertConfirmedProxyCode(client)
			else {
				const fundingShortfall = await getProxyDeployerFundingShortfall(client)
				const balance = await client.getBalance({ address: client.account.address })
				if (balance < fundingShortfall) throw new Error(`Deployer ${client.account.address} needs at least ${formatEther(fundingShortfall)} ETH to finish funding the canonical proxy deployer signer`)
			}
		}
	}

	log(
		formatLogSection('Network', [
			['Chain ID', chainId.toString()],
			['Deployer', client.account.address],
		]),
	)
	const results = await runDeploymentPlan(plan, client, log, undefined, knownInstalledAddresses)
	await assertProxyCode(client)
	const bootstrapDescendants = await assertBootstrapDescendantCode(client, profile)
	if (parameters.writeGitHubSummary !== false) await writeGitHubSummary(chainId, client.account.address, results)
	return { account: client.account.address, proofVerifier: bootstrapDescendants.escalationGameProofVerifier, results }
}

export function getDeploymentHelp() {
	return `Deploy the complete deterministic Zoltar infrastructure to an EVM testnet

Load PRIVATE_KEY into the environment from a secret manager or hidden prompt,
or pass --private-key=0x... if shell history exposure is acceptable.
Pass RPC and cost limits as uppercase assignments after --, for example:
  bun run deploy:testnet -- RPC_URL=https://... MAX_FEE_PER_GAS_GWEI=100 MAX_TOTAL_COST_ETH=20

  --private-key=0x...    Required unless PRIVATE_KEY is set
  --rpc-url=https://...   Required unless RPC_URL is set
  --chain-id=11155111     Defaults to Sepolia chain ID 11155111
  --max-fee-per-gas-gwei=100  Rejects higher RPC fee suggestions
  --max-total-cost-eth=20     Caps the preflight estimate and transaction costs

Custom testnets receive the same deterministic WETH and genesis REP deployment
used by Sepolia. The RPC must support Cancun, EIP-1559, and the canonical
unprotected legacy deployer transactions. Ethereum mainnet chain ID 1 is
intentionally rejected.`
}

function printHelp() {
	console.log(getDeploymentHelp())
}

async function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		printHelp()
		return
	}
	const { chainId, maxFeePerGas, maxTotalCost, privateKey, rpcUrl } = parseDeploymentCommandLine()
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
