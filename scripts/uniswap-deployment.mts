import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { concatHex, encodeAbiParameters, encodeDeployData, getAddress, getCreate2Address, keccak256, toHex, type Address, type Hash, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { waitForSubmittedTransactionReceipt } from '../ui/ts/protocol/core.ts'
import { assertCanonicalRawTransactionFeeCompatible, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST, fundCanonicalDeployerSigner, isInsufficientFundsError } from '../ui/ts/protocol/deployment.ts'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '../ui/ts/protocol/deploymentHelpers.ts'
import type { WriteClient } from '../ui/ts/lib/chainBackend.ts'

const V3_FACTORY_ARTIFACT = new URL('./artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json', import.meta.resolve('@uniswap/v3-core/package.json'))
const V3_QUOTER_ARTIFACT = new URL('./artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json', import.meta.resolve('@uniswap/v3-periphery/package.json'))
const V3_SWAP_ROUTER_ARTIFACT = new URL('./artifacts/contracts/SwapRouter.sol/SwapRouter.json', import.meta.resolve('@uniswap/v3-periphery/package.json'))
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
let permit2CompilationPromise: Promise<Permit2Compilation> | undefined
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
	verifyRuntimeCode?: (client: WriteClient, code: Hex) => Promise<void>
}

export type UniswapDeployment = {
	addresses: {
		arachnidCreate2DeployerAddress: Address
		permit2Address: Address
		uniswapV3FactoryAddress: Address
		uniswapV3QuoterAddress: Address
		uniswapV3SwapRouterAddress: Address
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
		deployedBytecode: {
			immutableReferences: Readonly<Record<string, readonly { length: number; start: number }[]>>
			object: string
		}
	}
}

type Permit2Compilation = {
	deployedBytecodeTemplate: Hex
	immutableReferences: readonly Permit2ImmutableReferences[]
	initCode: Hex
}

type Permit2ImmutableReferences = {
	name: '_CACHED_CHAIN_ID' | '_CACHED_DOMAIN_SEPARATOR'
	references: readonly { length: number; start: number }[]
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
	const deployedBytecode = evm['deployedBytecode']
	if (!isRecord(deployedBytecode) || typeof deployedBytecode['object'] !== 'string' || !isRecord(deployedBytecode['immutableReferences'])) throw new Error('Permit2 compiler did not return deployed bytecode and immutable references')
	const immutableReferences: Record<string, readonly { length: number; start: number }[]> = {}
	for (const [id, references] of Object.entries(deployedBytecode['immutableReferences'])) {
		if (!Array.isArray(references)) throw new Error(`Permit2 immutable ${id} does not contain reference ranges`)
		immutableReferences[id] = references.map(reference => {
			if (!isRecord(reference) || !Number.isSafeInteger(reference['length']) || !Number.isSafeInteger(reference['start'])) throw new Error(`Permit2 immutable ${id} contains an invalid reference range`)
			return { length: Number(reference['length']), start: Number(reference['start']) }
		})
	}
	return { evm: { bytecode: { object: bytecode['object'] }, deployedBytecode: { immutableReferences, object: deployedBytecode['object'] } } }
}

function collectPermit2ImmutableNames(value: unknown, names = new Map<string, string>()) {
	if (Array.isArray(value)) {
		for (const item of value) collectPermit2ImmutableNames(item, names)
		return names
	}
	if (!isRecord(value)) return names
	if (value['nodeType'] === 'VariableDeclaration' && value['mutability'] === 'immutable' && typeof value['id'] === 'number' && typeof value['name'] === 'string') names.set(value['id'].toString(), value['name'])
	for (const nested of Object.values(value)) collectPermit2ImmutableNames(nested, names)
	return names
}

function parsePermit2ImmutableName(name: string | undefined): Permit2ImmutableReferences['name'] {
	if (name === '_CACHED_CHAIN_ID' || name === '_CACHED_DOMAIN_SEPARATOR') return name
	throw new Error(`Permit2 compiler returned an unknown immutable ${name ?? '(missing name)'}`)
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
					outputSelection: { '*': { '': ['ast'], '*': ['evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } },
					viaIR: true,
				},
				sources,
			}),
		),
	)
	const permit2 = parseSolcContract(output).evm
	const immutableNames = collectPermit2ImmutableNames(output)
	return {
		deployedBytecodeTemplate: parseBytecode(permit2.deployedBytecode.object, 'Permit2 deployed bytecode'),
		immutableReferences: Object.entries(permit2.deployedBytecode.immutableReferences).map(([id, references]) => ({ name: parsePermit2ImmutableName(immutableNames.get(id)), references })),
		initCode: parseBytecode(permit2.bytecode.object, 'Permit2'),
	}
}

function getPermit2Compilation() {
	permit2CompilationPromise ??= compilePermit2InitCode()
	return permit2CompilationPromise
}

function normalizePermit2RuntimeCode(code: Hex, compilation: Permit2Compilation) {
	if (code.length !== compilation.deployedBytecodeTemplate.length) throw new Error('Permit2 runtime code has an unexpected length')
	let normalized = code.slice(2)
	for (const immutable of compilation.immutableReferences) {
		for (const { length, start } of immutable.references) {
			const firstCharacter = start * 2
			const lastCharacter = firstCharacter + length * 2
			normalized = `${normalized.slice(0, firstCharacter)}${'0'.repeat(length * 2)}${normalized.slice(lastCharacter)}`
		}
	}
	return `0x${normalized}` as Hex
}

export function assertPermit2ImmutableValues(code: Hex, immutableReferences: readonly Permit2ImmutableReferences[], expectedValues: { chainId: Hex; domainSeparator: Hash }) {
	const expectedByName: Readonly<Record<Permit2ImmutableReferences['name'], Hex>> = {
		_CACHED_CHAIN_ID: expectedValues.chainId,
		_CACHED_DOMAIN_SEPARATOR: expectedValues.domainSeparator,
	}
	if (immutableReferences.length !== 2) throw new Error(`Permit2 compiler returned ${immutableReferences.length.toString()} immutable groups instead of 2`)
	for (const immutable of immutableReferences) {
		if (immutable.references.length === 0) throw new Error(`Permit2 immutable ${immutable.name} has no runtime references`)
		for (const reference of immutable.references) {
			if (reference.length !== 32) throw new Error(`Permit2 immutable ${immutable.name} has a non-32-byte runtime reference`)
			const firstCharacter = 2 + reference.start * 2
			const actualValue = `0x${code.slice(firstCharacter, firstCharacter + reference.length * 2)}`
			if (actualValue !== expectedByName[immutable.name]) throw new Error(`Permit2 immutable ${immutable.name} does not match the selected chain`)
		}
	}
}

async function verifyPermit2RuntimeCode(client: WriteClient, code: Hex, compilation: Permit2Compilation) {
	const normalizedActualCode = normalizePermit2RuntimeCode(code, compilation)
	const normalizedTemplate = normalizePermit2RuntimeCode(compilation.deployedBytecodeTemplate, compilation)
	if (keccak256(normalizedActualCode) !== keccak256(normalizedTemplate)) throw new Error('Permit2 runtime code differs outside its chain-specific EIP-712 immutables')
	const chainId = await client.getChainId()
	const typeHash = keccak256(toHex('EIP712Domain(string name,uint256 chainId,address verifyingContract)'))
	const nameHash = keccak256(toHex('Permit2'))
	const expectedDomainSeparator = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }], [typeHash, nameHash, BigInt(chainId), PERMIT2_ADDRESS]))
	assertPermit2ImmutableValues(code, compilation.immutableReferences, {
		chainId: encodeAbiParameters([{ type: 'uint256' }], [BigInt(chainId)]),
		domainSeparator: expectedDomainSeparator,
	})
	const actualDomainSeparator = await client.readContract({
		abi: [{ inputs: [], name: 'DOMAIN_SEPARATOR', outputs: [{ type: 'bytes32' }], stateMutability: 'view', type: 'function' }] as const,
		address: PERMIT2_ADDRESS,
		functionName: 'DOMAIN_SEPARATOR',
	})
	if (actualDomainSeparator !== expectedDomainSeparator) throw new Error(`Permit2 DOMAIN_SEPARATOR does not match chain ${chainId.toString()} and canonical address ${PERMIT2_ADDRESS}`)
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

function accountCanonicalRawTransaction(client: WriteClient) {
	client.assertCanonicalRawTransactionCost?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
	client.recordCanonicalRawTransaction?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
}

async function resolveCreate2DeployerBroadcastRace(client: WriteClient, broadcastError: unknown) {
	if (await arachnidCreate2DeployerIsInstalled(client)) {
		client.recordCanonicalRawTransaction?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
		return ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH
	}
	const activity = await getArachnidCreate2DeployerActivity(client)
	if (activity.deploymentPending) {
		client.recordCanonicalRawTransaction?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
		return await waitForCanonicalCreate2Deployer(client)
	}
	if (activity.confirmedNonce !== 0n) {
		if (await arachnidCreate2DeployerIsInstalled(client)) {
			client.recordCanonicalRawTransaction?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
			return ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH
		}
		throw new Error('The canonical CREATE2 deployer signer nonce was consumed without installing the deployer', { cause: broadcastError })
	}
	throw broadcastError
}

async function broadcastCanonicalCreate2Deployer(client: WriteClient, allowInsufficientFunds: boolean) {
	client.assertCanonicalRawTransactionCost?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
	let hash: Hash
	try {
		hash = await client.sendRawTransaction({ serializedTransaction: ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION })
	} catch (error) {
		if (allowInsufficientFunds && isInsufficientFundsError(error)) {
			if (await arachnidCreate2DeployerIsInstalled(client)) {
				client.recordCanonicalRawTransaction?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
				return ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH
			}
			return undefined
		}
		try {
			return await resolveCreate2DeployerBroadcastRace(client, error)
		} catch (resolvedError) {
			if (allowInsufficientFunds) throw new Error(`RPC rejected the canonical CREATE2 deployer raw transaction before signer funding: ${resolvedError instanceof Error ? resolvedError.message : String(resolvedError)}`, { cause: resolvedError })
			throw resolvedError
		}
	}
	client.recordCanonicalRawTransaction?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt(client, hash)
	if (!(await arachnidCreate2DeployerIsInstalled(client))) throw new Error(`Canonical CREATE2 deployer transaction ${resolvedHash} succeeded without installing code at ${ARACHNID_CREATE2_DEPLOYER_ADDRESS}`)
	return resolvedHash
}

async function deployArachnidCreate2Deployer(client: WriteClient) {
	if (await arachnidCreate2DeployerIsInstalled(client)) return ZERO_HASH
	const activity = await getArachnidCreate2DeployerActivity(client)
	if (activity.deploymentPending) {
		accountCanonicalRawTransaction(client)
		return await waitForCanonicalCreate2Deployer(client)
	}
	if (activity.fundingPending) throw new Error('The canonical CREATE2 deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (await arachnidCreate2DeployerIsInstalled(client)) return ZERO_HASH
	if (activity.confirmedNonce !== 0n) throw new Error('The canonical CREATE2 deployer signer nonce has already been consumed, but the deployer is missing')
	const finalActivity = await getArachnidCreate2DeployerActivity(client)
	if (finalActivity.deploymentPending) return await waitForCanonicalCreate2Deployer(client)
	if (finalActivity.fundingPending) throw new Error('The canonical CREATE2 deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (await arachnidCreate2DeployerIsInstalled(client)) return ZERO_HASH
	if (finalActivity.confirmedNonce !== 0n) throw new Error('The canonical CREATE2 deployer signer nonce has already been consumed, but the deployer is missing')
	await assertCanonicalRawTransactionFeeCompatible(client, 'Canonical CREATE2 deployer')
	const preFundingDeploymentHash = await broadcastCanonicalCreate2Deployer(client, true)
	if (preFundingDeploymentHash !== undefined) return preFundingDeploymentHash
	const shortfall = arachnidCreate2DeployerShortfall(finalActivity.confirmedBalance)
	if (shortfall > 0n) {
		await fundCanonicalDeployerSigner(client, {
			expectedDeployer: ARACHNID_CREATE2_DEPLOYER_ADDRESS,
			label: 'canonical CREATE2 deployer',
			requiredBalance: ARACHNID_CREATE2_DEPLOYER_FUNDING,
			signer: ARACHNID_CREATE2_DEPLOYER_SIGNER,
		})
	}
	if (await arachnidCreate2DeployerIsInstalled(client)) {
		accountCanonicalRawTransaction(client)
		return ZERO_HASH
	}
	const postFundingActivity = await getArachnidCreate2DeployerActivity(client)
	if (postFundingActivity.deploymentPending) {
		accountCanonicalRawTransaction(client)
		return await waitForCanonicalCreate2Deployer(client)
	}
	if (postFundingActivity.fundingPending) throw new Error('The canonical CREATE2 deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (postFundingActivity.confirmedNonce !== 0n) throw new Error('The canonical CREATE2 deployer signer nonce has already been consumed, but the deployer is missing')
	const resolvedHash = await broadcastCanonicalCreate2Deployer(client, false)
	if (resolvedHash === undefined) throw new Error('Canonical CREATE2 deployer broadcast unexpectedly returned without a transaction hash')
	return resolvedHash
}

async function deployPermit2(client: WriteClient, initCode: Hex) {
	const hash = await client.sendTransaction({ data: concatHex([PERMIT2_SALT, initCode]), to: ARACHNID_CREATE2_DEPLOYER_ADDRESS })
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt(client, hash)
	return resolvedHash
}

export async function getUniswapDeployment(wethAddress: Address): Promise<UniswapDeployment> {
	const [permit2Compilation, v3FactoryInitCode, v3QuoterBytecode, v3SwapRouterBytecode, v4PoolManagerBytecode, v4QuoterBytecode] = await Promise.all([
		getPermit2Compilation(),
		loadArtifactBytecode(V3_FACTORY_ARTIFACT, 'Uniswap V3 Factory', 'hardhat'),
		loadArtifactBytecode(V3_QUOTER_ARTIFACT, 'Uniswap V3 QuoterV2', 'hardhat'),
		loadArtifactBytecode(V3_SWAP_ROUTER_ARTIFACT, 'Uniswap V3 SwapRouter', 'hardhat'),
		loadArtifactBytecode(V4_POOL_MANAGER_ARTIFACT, 'Uniswap V4 PoolManager', 'foundry'),
		loadArtifactBytecode(V4_QUOTER_ARTIFACT, 'Uniswap V4 Quoter', 'foundry'),
	])
	const permit2InitCode = permit2Compilation.initCode
	const computedPermit2Address = getCreate2Address({ bytecode: permit2InitCode, from: ARACHNID_CREATE2_DEPLOYER_ADDRESS, salt: PERMIT2_SALT })
	if (computedPermit2Address !== PERMIT2_ADDRESS) throw new Error(`Compiled Permit2 address ${computedPermit2Address} does not match canonical address ${PERMIT2_ADDRESS}`)

	const uniswapV3FactoryAddress = deterministicAddress(v3FactoryInitCode)
	const v3QuoterInitCode = encodeDeployData({
		abi: TWO_ADDRESS_CONSTRUCTOR_ABI,
		args: [uniswapV3FactoryAddress, wethAddress],
		bytecode: v3QuoterBytecode,
	})
	const uniswapV3QuoterAddress = deterministicAddress(v3QuoterInitCode)
	const v3SwapRouterInitCode = encodeDeployData({
		abi: TWO_ADDRESS_CONSTRUCTOR_ABI,
		args: [uniswapV3FactoryAddress, wethAddress],
		bytecode: v3SwapRouterBytecode,
	})
	const uniswapV3SwapRouterAddress = deterministicAddress(v3SwapRouterInitCode)
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
			uniswapV3SwapRouterAddress,
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
				verifyRuntimeCode: async (client, code) => await verifyPermit2RuntimeCode(client, code, permit2Compilation),
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
				address: uniswapV3SwapRouterAddress,
				dependencies: ['proxyDeployer', 'uniswapV3Factory'],
				deploy: async client => await deployViaProxy(client, v3SwapRouterInitCode),
				id: 'uniswapV3SwapRouter',
				label: 'Uniswap V3 SwapRouter',
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
