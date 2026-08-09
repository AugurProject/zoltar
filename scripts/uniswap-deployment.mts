import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { concatHex, encodeDeployData, getAddress, getCreate2Address, keccak256, type Address, type Hash, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { waitForSubmittedTransactionReceipt } from '../ui/ts/protocol/core.ts'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '../ui/ts/protocol/deploymentHelpers.ts'
import type { WriteClient } from '../ui/ts/lib/chainBackend.ts'

const V3_FACTORY_ARTIFACT = new URL('./artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json', import.meta.resolve('@uniswap/v3-core/package.json'))
const V3_QUOTER_ARTIFACT = new URL('./artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json', import.meta.resolve('@uniswap/v3-periphery/package.json'))
const V4_POOL_MANAGER_ARTIFACT = new URL('./out/PoolManager.sol/PoolManager.json', import.meta.resolve('@uniswap/v4-core/package.json'))
const V4_QUOTER_ARTIFACT = new URL('./foundry-out/V4Quoter.sol/V4Quoter.json', import.meta.resolve('@uniswap/v4-periphery/package.json'))
const PERMIT2_ROOT = new URL('./lib/permit2/', import.meta.resolve('@uniswap/v4-periphery/package.json'))

export const ARACHNID_CREATE2_DEPLOYER_ADDRESS = getAddress('0x4e59b44847b379578588920ca78fbf26c0b4956c')
export const ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE = '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3' satisfies Hex
export const PERMIT2_ADDRESS = getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3')

const ARACHNID_CREATE2_DEPLOYER_SIGNER = getAddress('0x3fab184622dc19b6109349b94811493bf2a45362')
const ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION =
	'0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' satisfies Hex
const ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH = keccak256(ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION)
const ARACHNID_CREATE2_DEPLOYER_FUNDING = 10_000_000_000_000_000n
const PERMIT2_SALT = '0x0000000000000000000000000000000000000000d3af2663da51c10215000000' satisfies Hex

const require = createRequire(import.meta.url)
const solc: { compile: (input: string) => string; version: () => string } = require('solc')
let permit2InitCodePromise: Promise<Hex> | undefined
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hash

const ADDRESS_CONSTRUCTOR_ABI = [
	{
		inputs: [{ name: 'dependency', type: 'address' }],
		stateMutability: 'nonpayable',
		type: 'constructor',
	},
] as const

const TWO_ADDRESS_CONSTRUCTOR_ABI = [
	{
		inputs: [
			{ name: 'firstDependency', type: 'address' },
			{ name: 'secondDependency', type: 'address' },
		],
		stateMutability: 'nonpayable',
		type: 'constructor',
	},
] as const

type UniswapArtifactLayout = 'hardhat' | 'foundry'

type UniswapDeploymentStep = {
	address: Address
	dependencies: readonly string[]
	deploy: (client: WriteClient) => Promise<Hash>
	id: string
	label: string
}

export type UniswapDeployment = {
	addresses: {
		arachnidCreate2DeployerAddress: Address
		permit2Address: Address
		uniswapV3FactoryAddress: Address
		uniswapV3QuoterAddress: Address
		uniswapV4PoolManagerAddress: Address
		uniswapV4QuoterAddress: Address
	}
	steps: readonly UniswapDeploymentStep[]
}

type SolcOutputContract = {
	evm: {
		bytecode: {
			object: string
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function parseBytecode(value: unknown, artifactName: string): Hex {
	if (typeof value !== 'string') throw new Error(`${artifactName} does not contain deployable bytecode`)
	const bytecode = value.startsWith('0x') ? value : `0x${value}`
	if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode)) throw new Error(`${artifactName} contains invalid or unlinked bytecode`)
	return bytecode as Hex
}

async function loadArtifactBytecode(artifactUrl: URL, artifactName: string, layout: UniswapArtifactLayout) {
	const artifact: unknown = await Bun.file(artifactUrl).json()
	if (!isRecord(artifact)) throw new Error(`${artifactName} artifact is not an object`)
	if (layout === 'hardhat') return parseBytecode(artifact['bytecode'], artifactName)
	const bytecode = artifact['bytecode']
	if (!isRecord(bytecode)) throw new Error(`${artifactName} does not contain a Foundry bytecode object`)
	return parseBytecode(bytecode['object'], artifactName)
}

function parseSolcContract(output: unknown): SolcOutputContract {
	if (!isRecord(output)) throw new Error('Permit2 compiler returned an invalid result')
	const errors = output['errors']
	if (Array.isArray(errors)) {
		const failures = errors.flatMap(error => {
			if (!isRecord(error) || error['severity'] !== 'error') return []
			return [String(error['formattedMessage'] ?? error['message'])]
		})
		if (failures.length > 0) throw new Error(`Permit2 compilation failed:\n${failures.join('\n')}`)
	}
	const contracts = output['contracts']
	if (!isRecord(contracts)) throw new Error('Permit2 compiler did not return contracts')
	const permit2Source = contracts['src/Permit2.sol']
	if (!isRecord(permit2Source)) throw new Error('Permit2 compiler did not return src/Permit2.sol')
	const permit2 = permit2Source['Permit2']
	if (!isRecord(permit2)) throw new Error('Permit2 compiler did not return the Permit2 contract')
	const evm = permit2['evm']
	if (!isRecord(evm)) throw new Error('Permit2 compiler did not return EVM output')
	const bytecode = evm['bytecode']
	if (!isRecord(bytecode) || typeof bytecode['object'] !== 'string') throw new Error('Permit2 compiler did not return creation bytecode')
	return { evm: { bytecode: { object: bytecode['object'] } } }
}

async function compilePermit2InitCode() {
	if (!solc.version().startsWith('0.8.17+')) throw new Error(`Permit2 requires solc 0.8.17, received ${solc.version()}`)
	const sources: Record<string, { content: string }> = {}
	const sourceRoot = fileURLToPath(new URL('./src/', PERMIT2_ROOT))
	for await (const relativePath of new Bun.Glob('**/*.sol').scan({ cwd: sourceRoot })) {
		sources[`src/${relativePath}`] = { content: await Bun.file(new URL(`./src/${relativePath}`, PERMIT2_ROOT)).text() }
	}
	for (const sourcePath of ['solmate/src/tokens/ERC20.sol', 'solmate/src/utils/SafeTransferLib.sol'] as const) {
		const relativePath = sourcePath.slice('solmate/'.length)
		sources[sourcePath] = { content: await Bun.file(new URL(`./lib/solmate/${relativePath}`, PERMIT2_ROOT)).text() }
	}
	const output: unknown = JSON.parse(
		solc.compile(
			JSON.stringify({
				language: 'Solidity',
				settings: {
					metadata: { bytecodeHash: 'none' },
					optimizer: { enabled: true, runs: 1_000_000 },
					outputSelection: { '*': { '*': ['evm.bytecode.object'] } },
					viaIR: true,
				},
				sources,
			}),
		),
	)
	return parseBytecode(parseSolcContract(output).evm.bytecode.object, 'Permit2')
}

function getPermit2InitCode() {
	permit2InitCodePromise ??= compilePermit2InitCode()
	return permit2InitCodePromise
}

function deterministicAddress(initCode: Hex) {
	return getCreate2Address({ bytecode: initCode, from: PROXY_DEPLOYER_ADDRESS, salt: ZERO_SALT })
}

async function deployViaProxy(client: WriteClient, initCode: Hex) {
	const hash = await client.sendTransaction({ data: initCode, to: PROXY_DEPLOYER_ADDRESS })
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt(client, hash)
	return resolvedHash
}

async function getArachnidCreate2DeployerActivity(client: WriteClient) {
	const [confirmedBalance, pendingBalance, confirmedNonce, pendingNonce] = await Promise.all([
		client.getBalance({ address: ARACHNID_CREATE2_DEPLOYER_SIGNER, blockTag: 'latest' }),
		client.getBalance({ address: ARACHNID_CREATE2_DEPLOYER_SIGNER, blockTag: 'pending' }),
		client.getTransactionCount({ address: ARACHNID_CREATE2_DEPLOYER_SIGNER, blockTag: 'latest' }),
		client.getTransactionCount({ address: ARACHNID_CREATE2_DEPLOYER_SIGNER, blockTag: 'pending' }),
	])
	return {
		confirmedBalance,
		confirmedNonce,
		deploymentPending: pendingNonce !== confirmedNonce,
		fundingPending: pendingBalance !== confirmedBalance,
		pending: pendingBalance !== confirmedBalance || pendingNonce !== confirmedNonce,
	}
}

async function arachnidCreate2DeployerIsInstalled(client: WriteClient) {
	const code = await client.getCode({ address: ARACHNID_CREATE2_DEPLOYER_ADDRESS })
	if (code === undefined || code === '0x') return false
	if (code.toLowerCase() !== ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE.toLowerCase()) throw new Error(`Unexpected code at canonical CREATE2 deployer ${ARACHNID_CREATE2_DEPLOYER_ADDRESS}`)
	return true
}

function arachnidCreate2DeployerShortfall(balance: bigint) {
	return balance >= ARACHNID_CREATE2_DEPLOYER_FUNDING ? 0n : ARACHNID_CREATE2_DEPLOYER_FUNDING - balance
}

async function waitForCanonicalCreate2Deployer(client: WriteClient) {
	const { hash } = await waitForSubmittedTransactionReceipt(client, ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH)
	if (!(await arachnidCreate2DeployerIsInstalled(client))) throw new Error(`Canonical CREATE2 deployer transaction ${hash} confirmed without installing code at ${ARACHNID_CREATE2_DEPLOYER_ADDRESS}`)
	return hash
}

async function resolveCreate2DeployerBroadcastRace(client: WriteClient, broadcastError: unknown) {
	if (await arachnidCreate2DeployerIsInstalled(client)) return ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH
	const activity = await getArachnidCreate2DeployerActivity(client)
	if (activity.deploymentPending) return await waitForCanonicalCreate2Deployer(client)
	if (activity.confirmedNonce !== 0n) {
		if (await arachnidCreate2DeployerIsInstalled(client)) return ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH
		throw new Error('The canonical CREATE2 deployer signer nonce was consumed without installing the deployer', { cause: broadcastError })
	}
	throw broadcastError
}

async function deployArachnidCreate2Deployer(client: WriteClient) {
	if (await arachnidCreate2DeployerIsInstalled(client)) return ZERO_HASH
	const activity = await getArachnidCreate2DeployerActivity(client)
	if (activity.deploymentPending) return await waitForCanonicalCreate2Deployer(client)
	if (activity.fundingPending) throw new Error('The canonical CREATE2 deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (await arachnidCreate2DeployerIsInstalled(client)) return ZERO_HASH
	if (activity.confirmedNonce !== 0n) throw new Error('The canonical CREATE2 deployer signer nonce has already been consumed, but the deployer is missing')
	const finalActivity = await getArachnidCreate2DeployerActivity(client)
	if (finalActivity.deploymentPending) return await waitForCanonicalCreate2Deployer(client)
	if (finalActivity.fundingPending) throw new Error('The canonical CREATE2 deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (await arachnidCreate2DeployerIsInstalled(client)) return ZERO_HASH
	if (finalActivity.confirmedNonce !== 0n) throw new Error('The canonical CREATE2 deployer signer nonce has already been consumed, but the deployer is missing')
	const shortfall = arachnidCreate2DeployerShortfall(finalActivity.confirmedBalance)
	if (shortfall > 0n) {
		const fundHash = await client.sendTransaction({ to: ARACHNID_CREATE2_DEPLOYER_SIGNER, value: shortfall })
		await waitForSubmittedTransactionReceipt(client, fundHash)
	}
	if (await arachnidCreate2DeployerIsInstalled(client)) return ZERO_HASH
	const postFundingActivity = await getArachnidCreate2DeployerActivity(client)
	if (postFundingActivity.deploymentPending) return await waitForCanonicalCreate2Deployer(client)
	if (postFundingActivity.fundingPending) throw new Error('The canonical CREATE2 deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (postFundingActivity.confirmedNonce !== 0n) throw new Error('The canonical CREATE2 deployer signer nonce has already been consumed, but the deployer is missing')
	let hash: Hash
	try {
		hash = await client.sendRawTransaction({ serializedTransaction: ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION })
	} catch (error) {
		return await resolveCreate2DeployerBroadcastRace(client, error)
	}
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt(client, hash)
	if (!(await arachnidCreate2DeployerIsInstalled(client))) throw new Error(`Canonical CREATE2 deployer transaction ${resolvedHash} succeeded without installing code at ${ARACHNID_CREATE2_DEPLOYER_ADDRESS}`)
	return resolvedHash
}

async function deployPermit2(client: WriteClient, initCode: Hex) {
	const hash = await client.sendTransaction({ data: concatHex([PERMIT2_SALT, initCode]), to: ARACHNID_CREATE2_DEPLOYER_ADDRESS })
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt(client, hash)
	return resolvedHash
}

export async function getUniswapDeployment(wethAddress: Address): Promise<UniswapDeployment> {
	const [permit2InitCode, v3FactoryInitCode, v3QuoterBytecode, v4PoolManagerBytecode, v4QuoterBytecode] = await Promise.all([
		getPermit2InitCode(),
		loadArtifactBytecode(V3_FACTORY_ARTIFACT, 'Uniswap V3 Factory', 'hardhat'),
		loadArtifactBytecode(V3_QUOTER_ARTIFACT, 'Uniswap V3 QuoterV2', 'hardhat'),
		loadArtifactBytecode(V4_POOL_MANAGER_ARTIFACT, 'Uniswap V4 PoolManager', 'foundry'),
		loadArtifactBytecode(V4_QUOTER_ARTIFACT, 'Uniswap V4 Quoter', 'foundry'),
	])
	const computedPermit2Address = getCreate2Address({ bytecode: permit2InitCode, from: ARACHNID_CREATE2_DEPLOYER_ADDRESS, salt: PERMIT2_SALT })
	if (computedPermit2Address !== PERMIT2_ADDRESS) throw new Error(`Compiled Permit2 address ${computedPermit2Address} does not match canonical address ${PERMIT2_ADDRESS}`)

	const uniswapV3FactoryAddress = deterministicAddress(v3FactoryInitCode)
	const v3QuoterInitCode = encodeDeployData({
		abi: TWO_ADDRESS_CONSTRUCTOR_ABI,
		args: [uniswapV3FactoryAddress, wethAddress],
		bytecode: v3QuoterBytecode,
	})
	const uniswapV3QuoterAddress = deterministicAddress(v3QuoterInitCode)
	const v4PoolManagerInitCode = encodeDeployData({
		abi: ADDRESS_CONSTRUCTOR_ABI,
		args: [zeroAddress],
		bytecode: v4PoolManagerBytecode,
	})
	const uniswapV4PoolManagerAddress = deterministicAddress(v4PoolManagerInitCode)
	const v4QuoterInitCode = encodeDeployData({
		abi: ADDRESS_CONSTRUCTOR_ABI,
		args: [uniswapV4PoolManagerAddress],
		bytecode: v4QuoterBytecode,
	})
	const uniswapV4QuoterAddress = deterministicAddress(v4QuoterInitCode)

	return {
		addresses: {
			arachnidCreate2DeployerAddress: ARACHNID_CREATE2_DEPLOYER_ADDRESS,
			permit2Address: PERMIT2_ADDRESS,
			uniswapV3FactoryAddress,
			uniswapV3QuoterAddress,
			uniswapV4PoolManagerAddress,
			uniswapV4QuoterAddress,
		},
		steps: [
			{
				address: ARACHNID_CREATE2_DEPLOYER_ADDRESS,
				dependencies: [],
				deploy: deployArachnidCreate2Deployer,
				id: 'arachnidCreate2Deployer',
				label: 'Canonical CREATE2 Deployer',
			},
			{
				address: PERMIT2_ADDRESS,
				dependencies: ['arachnidCreate2Deployer'],
				deploy: async client => await deployPermit2(client, permit2InitCode),
				id: 'permit2',
				label: 'Uniswap Permit2',
			},
			{
				address: uniswapV3FactoryAddress,
				dependencies: ['proxyDeployer'],
				deploy: async client => await deployViaProxy(client, v3FactoryInitCode),
				id: 'uniswapV3Factory',
				label: 'Uniswap V3 Factory',
			},
			{
				address: uniswapV3QuoterAddress,
				dependencies: ['proxyDeployer', 'uniswapV3Factory'],
				deploy: async client => await deployViaProxy(client, v3QuoterInitCode),
				id: 'uniswapV3Quoter',
				label: 'Uniswap V3 QuoterV2',
			},
			{
				address: uniswapV4PoolManagerAddress,
				dependencies: ['proxyDeployer'],
				deploy: async client => await deployViaProxy(client, v4PoolManagerInitCode),
				id: 'uniswapV4PoolManager',
				label: 'Uniswap V4 PoolManager',
			},
			{
				address: uniswapV4QuoterAddress,
				dependencies: ['proxyDeployer', 'uniswapV4PoolManager'],
				deploy: async client => await deployViaProxy(client, v4QuoterInitCode),
				id: 'uniswapV4Quoter',
				label: 'Uniswap V4 Quoter',
			},
		],
	}
}
