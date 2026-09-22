import { concatHex, encodeAbiParameters, encodeDeployData, getAddress, getCreateAddress, getCreate2Address, keccak256, toHex, type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { readWithRpcStateRetries, type RpcStateRetryWait } from '../../ui/coreShared/ts/lib/rpcStateRetries.ts'
import { waitForSubmittedTransactionReceipt } from '../../ui/zoltarShared/ts/protocol/core.ts'
import type { TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { assertCanonicalRawTransactionFeeCompatible, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST, fundCanonicalDeployerSigner, isInsufficientFundsError } from '../../ui/zoltarShared/ts/protocol/deployment.ts'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '../../ui/zoltarShared/ts/protocol/zoltarDeploymentHelpers.ts'
import type { WriteClient } from '../../ui/coreShared/ts/wallet/chainBackend.ts'
import { SEPOLIA_NETWORK_PROFILE } from '../../ui/coreShared/ts/wallet/networkProfile.ts'

const UNISWAP_DEPLOYMENT_ARTIFACT = new URL('../../scripts/artifacts/uniswap-deployment.json', import.meta.url)
const UNISWAP_DEPLOYMENT_ARTIFACT_SHA256 = '1dede65404f6e3f7c912e8798077f4235af1831a48c50a08672bfccb986f98ea'

export const ARACHNID_CREATE2_DEPLOYER_ADDRESS = getAddress('0x4e59b44847b379578588920ca78fbf26c0b4956c')
export const ARACHNID_CREATE2_DEPLOYER_RUNTIME_CODE = '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3' satisfies Hex
export const PERMIT2_ADDRESS = getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3')
export const SEPOLIA_CHAIN_ID = SEPOLIA_NETWORK_PROFILE.chain.id
// Uniswap's published Sepolia deployment, used by every testnet:
// https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments
// https://developers.uniswap.org/docs/protocols/v4/deployments
// Uniswap publishes no SwapRouter (v1) on Sepolia, so the deployer still installs a
// deterministic SwapRouter bound to the published factory for the arbitrage executor.
export const SEPOLIA_PUBLISHED_UNISWAP_ADDRESSES = {
	uniswapV3FactoryAddress: getAddress('0x0227628f3F023bb0B980b67D528571c95c6DaC1c'),
	uniswapV3QuoterAddress: getAddress('0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3'),
	uniswapV4PoolManagerAddress: getAddress('0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'),
	uniswapV4QuoterAddress: getAddress('0x61b3f2011a92d183c7dbadbda940a7555ccf9227'),
} as const
const DEVELOPMENT_NODE_CREATOR_BALANCE = 1_000_000_000_000_000_000n
// tooling/contracts/deployment-runtime-hashes.test.ts verifies this on Anvil.
const SEPOLIA_SWAP_ROUTER_RUNTIME_CODE_HASH = '0xca7d8f5518a35dc3dae4f1a90b95c16307baec1321442b55aa82187eff242faf' satisfies Hash

const ARACHNID_CREATE2_DEPLOYER_SIGNER = getAddress('0x3fab184622dc19b6109349b94811493bf2a45362')
const ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION =
	'0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' satisfies Hex
const ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH = keccak256(ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION)
const ARACHNID_CREATE2_DEPLOYER_FUNDING = 10_000_000_000_000_000n
const PERMIT2_SALT = '0x0000000000000000000000000000000000000000d3af2663da51c10215000000' satisfies Hex

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hash

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

type UniswapDeploymentStep = {
	address: Address
	dependencies: readonly string[]
	deploy: (client: WriteClient) => Promise<Hash>
	expectedRuntimeCodeHash?: Hash
	id: string
	label: string
	verifyRuntimeCode?: (client: WriteClient, code: Hex) => Promise<void>
}

type PublishedContractInstall = { creator: Address; initCode: Hex; kind: 'create'; nonce: bigint } | { creator: Address; deployer: Address; initCode: Hex; kind: 'create2'; salt: Hash }

export type PublishedContract = {
	address: Address
	expectedRuntimeCodeHash: Hash
	id: string
	install: PublishedContractInstall
	label: string
	transactionHash: Hash
}

export type DevelopmentNodeRpc = (method: string, params: readonly unknown[]) => Promise<unknown>

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
	publishedContracts: readonly PublishedContract[]
	steps: readonly UniswapDeploymentStep[]
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

type PublishedContractId = 'weth' | 'uniswapV3Factory' | 'uniswapV3Quoter' | 'uniswapV4PoolManager' | 'uniswapV4Quoter'

type PublishedContractRecord = Omit<PublishedContract, 'id' | 'label'>

type UniswapDeploymentArtifacts = {
	permit2: Permit2Compilation
	sepoliaPublished: Readonly<Record<PublishedContractId, PublishedContractRecord>>
	uniswapV3SwapRouter: Hex
}

const PUBLISHED_CONTRACT_LABELS: Readonly<Record<PublishedContractId, string>> = {
	uniswapV3Factory: 'Uniswap V3 Factory',
	uniswapV3Quoter: 'Uniswap V3 QuoterV2',
	uniswapV4PoolManager: 'Uniswap V4 PoolManager',
	uniswapV4Quoter: 'Uniswap V4 Quoter',
	weth: 'Wrapped Ether',
}

const EXPECTED_UNISWAP_ARTIFACT_SOURCES = {
	'@uniswap/v3-core': '1.0.1',
	'@uniswap/v3-periphery': '1.4.4',
	'@uniswap/v4-core': '1.0.2',
	'@uniswap/v4-periphery': '1.0.3',
} as const

let uniswapDeploymentArtifactsPromise: Promise<UniswapDeploymentArtifacts> | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function parseBytecode(value: unknown, artifactName: string): Hex {
	if (typeof value !== 'string') throw new Error(`${artifactName} does not contain deployable bytecode`)
	const bytecode = value.startsWith('0x') ? value : `0x${value}`
	if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode)) throw new Error(`${artifactName} contains invalid or unlinked bytecode`)
	return bytecode as Hex
}

function parseHash(value: unknown, label: string): Hash {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} is not a 32-byte hash`)
	return value.toLowerCase() as Hash
}

function parseAddressField(value: unknown, label: string): Address {
	if (typeof value !== 'string') throw new Error(`${label} is not an address`)
	return getAddress(value)
}

function parsePublishedContract(value: unknown, id: PublishedContractId): PublishedContractRecord {
	const label = `Published ${id}`
	if (!isRecord(value)) throw new Error(`${label} deployment record is not an object`)
	const address = parseAddressField(value['address'], `${label} address`)
	const creator = parseAddressField(value['creator'], `${label} creator`)
	const initCode = parseBytecode(value['initCode'], label)
	const shared = { address, expectedRuntimeCodeHash: parseHash(value['runtimeCodeHash'], `${label} runtime code hash`), transactionHash: parseHash(value['transactionHash'], `${label} transaction hash`) }
	if ('deployer' in value) {
		const deployer = parseAddressField(value['deployer'], `${label} deployer`)
		if (deployer !== ARACHNID_CREATE2_DEPLOYER_ADDRESS) throw new Error(`${label} was not created through the canonical CREATE2 deployer`)
		const salt = parseHash(value['salt'], `${label} salt`)
		if (getCreate2Address({ bytecode: initCode, from: deployer, salt }) !== address) throw new Error(`${label} init code and salt do not produce ${address}`)
		return { ...shared, install: { creator, deployer, initCode, kind: 'create2', salt } }
	}
	const nonce = value['nonce']
	if (typeof nonce !== 'number' || !Number.isSafeInteger(nonce) || nonce < 0) throw new Error(`${label} nonce is invalid`)
	if (getCreateAddress({ from: creator, nonce: BigInt(nonce) }) !== address) throw new Error(`${label} creator and nonce do not produce ${address}`)
	return { ...shared, install: { creator, initCode, kind: 'create', nonce: BigInt(nonce) } }
}

function parsePermit2ImmutableName(name: string | undefined): Permit2ImmutableReferences['name'] {
	if (name === '_CACHED_CHAIN_ID' || name === '_CACHED_DOMAIN_SEPARATOR') return name
	throw new Error(`Permit2 deployment artifact contains an unknown immutable ${name ?? '(missing name)'}`)
}

function parsePermit2Compilation(value: unknown): Permit2Compilation {
	if (!isRecord(value)) throw new Error('Permit2 deployment artifact is not an object')
	const references = value['immutableReferences']
	if (!Array.isArray(references)) throw new Error('Permit2 deployment artifact does not contain immutable references')
	return {
		deployedBytecodeTemplate: parseBytecode(value['deployedBytecodeTemplate'], 'Permit2 deployed bytecode'),
		immutableReferences: references.map((immutable, index) => {
			if (!isRecord(immutable) || !Array.isArray(immutable['references'])) throw new Error(`Permit2 immutable group ${index.toString()} is invalid`)
			return {
				name: parsePermit2ImmutableName(typeof immutable['name'] === 'string' ? immutable['name'] : undefined),
				references: immutable['references'].map((reference, referenceIndex) => {
					if (!isRecord(reference) || !Number.isSafeInteger(reference['length']) || !Number.isSafeInteger(reference['start']) || Number(reference['length']) <= 0 || Number(reference['start']) < 0) {
						throw new Error(`Permit2 immutable group ${index.toString()} reference ${referenceIndex.toString()} is invalid`)
					}
					return { length: Number(reference['length']), start: Number(reference['start']) }
				}),
			}
		}),
		initCode: parseBytecode(value['initCode'], 'Permit2'),
	}
}

function parseUniswapDeploymentArtifacts(contents: string): UniswapDeploymentArtifacts {
	const canonicalContents = contents.replaceAll('\r\n', '\n')
	const actualSha256 = new Bun.CryptoHasher('sha256').update(canonicalContents).digest('hex')
	if (actualSha256 !== UNISWAP_DEPLOYMENT_ARTIFACT_SHA256) {
		throw new Error(`Uniswap deployment artifact is stale or changed: expected SHA-256 ${UNISWAP_DEPLOYMENT_ARTIFACT_SHA256}, received ${actualSha256}`)
	}
	const value: unknown = JSON.parse(canonicalContents)
	if (!isRecord(value) || value['formatVersion'] !== 2) throw new Error('Uniswap deployment artifact has an unsupported format')
	const sources = value['sources']
	if (!isRecord(sources)) throw new Error('Uniswap deployment artifact does not identify its sources')
	for (const [packageName, expectedVersion] of Object.entries(EXPECTED_UNISWAP_ARTIFACT_SOURCES)) {
		if (sources[packageName] !== expectedVersion) throw new Error(`Uniswap deployment artifact must use ${packageName} ${expectedVersion}`)
	}
	const published = value['sepoliaPublished']
	if (!isRecord(published)) throw new Error('Uniswap deployment artifact does not contain the published Sepolia contracts')
	return {
		permit2: parsePermit2Compilation(value['permit2']),
		sepoliaPublished: {
			uniswapV3Factory: parsePublishedContract(published['uniswapV3Factory'], 'uniswapV3Factory'),
			uniswapV3Quoter: parsePublishedContract(published['uniswapV3Quoter'], 'uniswapV3Quoter'),
			uniswapV4PoolManager: parsePublishedContract(published['uniswapV4PoolManager'], 'uniswapV4PoolManager'),
			uniswapV4Quoter: parsePublishedContract(published['uniswapV4Quoter'], 'uniswapV4Quoter'),
			weth: parsePublishedContract(published['weth'], 'weth'),
		},
		uniswapV3SwapRouter: parseBytecode(value['uniswapV3SwapRouter'], 'Uniswap V3 SwapRouter'),
	}
}

export function assertUniswapDeploymentArtifact(contents: string) {
	parseUniswapDeploymentArtifacts(contents)
}

async function loadUniswapDeploymentArtifacts() {
	return parseUniswapDeploymentArtifacts(await Bun.file(UNISWAP_DEPLOYMENT_ARTIFACT).text())
}

function getUniswapDeploymentArtifacts() {
	uniswapDeploymentArtifactsPromise ??= loadUniswapDeploymentArtifacts()
	return uniswapDeploymentArtifactsPromise
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
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt<TransactionReceipt>(client, hash)
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

async function create2DeployerIsInstalledAfterReceipt(client: WriteClient, wait?: RpcStateRetryWait) {
	return await readWithRpcStateRetries(
		() => arachnidCreate2DeployerIsInstalled(client),
		installed => installed,
		wait,
	)
}

async function resolveConfirmedCreate2Deployer(client: WriteClient, wait?: RpcStateRetryWait) {
	if (!(await create2DeployerIsInstalledAfterReceipt(client, wait))) throw new Error('The canonical CREATE2 deployer signer nonce has already been consumed, but the deployer is missing')
	accountCanonicalRawTransaction(client)
	return ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH
}

export async function resolveCanonicalCreate2DeployerForPreflight(client: WriteClient, wait?: RpcStateRetryWait) {
	if (await arachnidCreate2DeployerIsInstalled(client)) return true
	const confirmedNonce = await client.getTransactionCount({ address: ARACHNID_CREATE2_DEPLOYER_SIGNER, blockTag: 'latest' })
	if (confirmedNonce === 0n) return false
	if (!(await create2DeployerIsInstalledAfterReceipt(client, wait))) throw new Error('The canonical CREATE2 deployer signer nonce has already been consumed, but the deployer is missing')
	return true
}

async function waitForCanonicalCreate2Deployer(client: WriteClient, wait?: RpcStateRetryWait) {
	const { hash } = await waitForSubmittedTransactionReceipt<TransactionReceipt>(client, ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH)
	if (!(await create2DeployerIsInstalledAfterReceipt(client, wait))) throw new Error(`Canonical CREATE2 deployer transaction ${hash} confirmed without installing code at ${ARACHNID_CREATE2_DEPLOYER_ADDRESS}`)
	return hash
}

function accountCanonicalRawTransaction(client: WriteClient) {
	client.assertCanonicalRawTransactionCost?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
	client.recordCanonicalRawTransaction?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
}

async function resolveCreate2DeployerBroadcastRace(client: WriteClient, broadcastError: unknown, wait?: RpcStateRetryWait) {
	if (await arachnidCreate2DeployerIsInstalled(client)) {
		client.recordCanonicalRawTransaction?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
		return ARACHNID_CREATE2_DEPLOYER_RAW_TRANSACTION_HASH
	}
	const activity = await getArachnidCreate2DeployerActivity(client)
	if (activity.deploymentPending) {
		client.recordCanonicalRawTransaction?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
		return await waitForCanonicalCreate2Deployer(client, wait)
	}
	if (activity.confirmedNonce !== 0n) {
		try {
			return await resolveConfirmedCreate2Deployer(client, wait)
		} catch (error) {
			throw new Error('The canonical CREATE2 deployer signer nonce was consumed without installing the deployer', { cause: error ?? broadcastError })
		}
	}
	throw broadcastError
}

async function broadcastCanonicalCreate2Deployer(client: WriteClient, allowInsufficientFunds: boolean, wait?: RpcStateRetryWait) {
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
			return await resolveCreate2DeployerBroadcastRace(client, error, wait)
		} catch (resolvedError) {
			if (allowInsufficientFunds) throw new Error(`RPC rejected the canonical CREATE2 deployer raw transaction before signer funding: ${resolvedError instanceof Error ? resolvedError.message : String(resolvedError)}`, { cause: resolvedError })
			throw resolvedError
		}
	}
	client.recordCanonicalRawTransaction?.(ARACHNID_CREATE2_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt<TransactionReceipt>(client, hash)
	if (!(await create2DeployerIsInstalledAfterReceipt(client, wait))) throw new Error(`Canonical CREATE2 deployer transaction ${resolvedHash} succeeded without installing code at ${ARACHNID_CREATE2_DEPLOYER_ADDRESS}`)
	return resolvedHash
}

async function deployArachnidCreate2Deployer(client: WriteClient, wait?: RpcStateRetryWait) {
	if (await arachnidCreate2DeployerIsInstalled(client)) return ZERO_HASH
	const activity = await getArachnidCreate2DeployerActivity(client)
	if (activity.deploymentPending) {
		accountCanonicalRawTransaction(client)
		return await waitForCanonicalCreate2Deployer(client, wait)
	}
	if (activity.fundingPending) throw new Error('The canonical CREATE2 deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (await arachnidCreate2DeployerIsInstalled(client)) return ZERO_HASH
	if (activity.confirmedNonce !== 0n) return await resolveConfirmedCreate2Deployer(client, wait)
	const finalActivity = await getArachnidCreate2DeployerActivity(client)
	if (finalActivity.deploymentPending) return await waitForCanonicalCreate2Deployer(client, wait)
	if (finalActivity.fundingPending) throw new Error('The canonical CREATE2 deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (await arachnidCreate2DeployerIsInstalled(client)) return ZERO_HASH
	if (finalActivity.confirmedNonce !== 0n) return await resolveConfirmedCreate2Deployer(client, wait)
	await assertCanonicalRawTransactionFeeCompatible(client, 'Canonical CREATE2 deployer')
	const preFundingDeploymentHash = await broadcastCanonicalCreate2Deployer(client, true, wait)
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
		return await waitForCanonicalCreate2Deployer(client, wait)
	}
	if (postFundingActivity.fundingPending) throw new Error('The canonical CREATE2 deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (postFundingActivity.confirmedNonce !== 0n) return await resolveConfirmedCreate2Deployer(client, wait)
	const resolvedHash = await broadcastCanonicalCreate2Deployer(client, false, wait)
	if (resolvedHash === undefined) throw new Error('Canonical CREATE2 deployer broadcast unexpectedly returned without a transaction hash')
	return resolvedHash
}

async function deployPermit2(client: WriteClient, initCode: Hex) {
	const hash = await client.sendTransaction({ data: concatHex([PERMIT2_SALT, initCode]), to: ARACHNID_CREATE2_DEPLOYER_ADDRESS })
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt<TransactionReceipt>(client, hash)
	return resolvedHash
}

export function createDevelopmentNodeRpc(rpcUrl: string): DevelopmentNodeRpc {
	return async (method, params) => {
		const response = await fetch(rpcUrl, { body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }), headers: { 'content-type': 'application/json' }, method: 'POST' })
		const payload: unknown = await response.json()
		if (typeof payload !== 'object' || payload === null) throw new Error(`RPC ${method} returned an invalid response`)
		if ('error' in payload && payload.error !== undefined && payload.error !== null) throw new Error(`RPC ${method} failed: ${JSON.stringify(payload.error)}`)
		return 'result' in payload ? payload.result : undefined
	}
}

function hasCode(code: Hex | undefined): code is Hex {
	return code !== undefined && code !== '0x'
}

async function isDevelopmentNode(rpc: DevelopmentNodeRpc) {
	try {
		await rpc('anvil_nodeInfo', [])
		return true
	} catch (error) {
		if (error instanceof Error) return false
		throw error
	}
}

async function sendFromImpersonatedAccount(client: Pick<WriteClient, 'waitForTransactionReceipt'>, rpc: DevelopmentNodeRpc, creator: Address, nonce: bigint | undefined, transaction: { data: Hex; to?: Address }) {
	await rpc('anvil_impersonateAccount', [creator])
	try {
		await rpc('anvil_setBalance', [creator, `0x${DEVELOPMENT_NODE_CREATOR_BALANCE.toString(16)}`])
		if (nonce !== undefined) await rpc('anvil_setNonce', [creator, `0x${nonce.toString(16)}`])
		const hash = await rpc('eth_sendTransaction', [{ ...transaction, from: creator }])
		if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Development node returned an invalid transaction hash')
		const receipt = await client.waitForTransactionReceipt({ hash: hash as Hash })
		if (receipt.status !== 'success') throw new Error(`Development node transaction ${hash} reverted`)
		return receipt
	} finally {
		await rpc('anvil_stopImpersonatingAccount', [creator])
	}
}

async function installPublishedContract(client: WriteClient, rpc: DevelopmentNodeRpc, contract: PublishedContract, wait?: RpcStateRetryWait) {
	if (contract.install.kind === 'create') {
		const receipt = await sendFromImpersonatedAccount(client, rpc, contract.install.creator, contract.install.nonce, { data: contract.install.initCode })
		const created = receipt.contractAddress ?? undefined
		if (created === undefined || getAddress(created) !== contract.address) throw new Error(`${contract.label} was created at ${created === undefined ? 'no address' : getAddress(created)} instead of the published address ${contract.address}`)
		return
	}
	// The published CREATE2 deployment replays through the canonical deployer from the creator's live nonce.
	if (!(await arachnidCreate2DeployerIsInstalled(client))) await deployArachnidCreate2Deployer(client, wait)
	await sendFromImpersonatedAccount(client, rpc, contract.install.creator, undefined, { data: concatHex([contract.install.salt, contract.install.initCode]), to: contract.install.deployer })
}

function assertPublishedRuntimeCode(contract: PublishedContract, code: Hex) {
	const actual = keccak256(code)
	if (actual !== contract.expectedRuntimeCodeHash) throw new Error(`Unexpected runtime code for ${contract.label} at ${contract.address}: expected ${contract.expectedRuntimeCodeHash}, received ${actual}`)
}

/**
 * Verifies that every published contract has Uniswap's exact runtime code. On a
 * development node (Anvil) the missing ones are installed at their published
 * addresses by replaying Uniswap's original creation transactions byte for byte;
 * anywhere else missing contracts abort.
 */
export async function ensurePublishedContracts(client: WriteClient, rpc: DevelopmentNodeRpc, chainId: number, contracts: readonly PublishedContract[], log: (message: string) => void = () => undefined, wait?: RpcStateRetryWait) {
	const missing: PublishedContract[] = []
	for (const contract of contracts) {
		const code = await client.getCode({ address: contract.address })
		if (hasCode(code)) assertPublishedRuntimeCode(contract, code)
		else missing.push(contract)
	}
	if (missing.length === 0) return []
	if (!(await isDevelopmentNode(rpc))) {
		throw new Error(`${missing.map(contract => `${contract.label} (${contract.address})`).join(', ')} published by Uniswap ${missing.length === 1 ? 'has' : 'have'} no code on chain ${chainId.toString()}. Use a Sepolia RPC or an Anvil development node.`)
	}
	for (const contract of missing) {
		log(`${contract.label} (${contract.id})\n  ├─ Address: ${contract.address}\n  ├─ Replaying: ${contract.transactionHash}\n  └─ Status: installing on the development node`)
		await installPublishedContract(client, rpc, contract, wait)
		const code = await client.getCode({ address: contract.address })
		if (!hasCode(code)) throw new Error(`${contract.label} installation left no code at ${contract.address}`)
		assertPublishedRuntimeCode(contract, code)
	}
	return missing.map(contract => contract.id)
}

export async function getUniswapDeployment(wait?: RpcStateRetryWait): Promise<UniswapDeployment> {
	const artifacts = await getUniswapDeploymentArtifacts()
	const permit2Compilation = artifacts.permit2
	const permit2InitCode = permit2Compilation.initCode
	const computedPermit2Address = getCreate2Address({ bytecode: permit2InitCode, from: ARACHNID_CREATE2_DEPLOYER_ADDRESS, salt: PERMIT2_SALT })
	if (computedPermit2Address !== PERMIT2_ADDRESS) throw new Error(`Compiled Permit2 address ${computedPermit2Address} does not match canonical address ${PERMIT2_ADDRESS}`)
	const { uniswapV3FactoryAddress, uniswapV3QuoterAddress, uniswapV4PoolManagerAddress, uniswapV4QuoterAddress } = SEPOLIA_PUBLISHED_UNISWAP_ADDRESSES
	// The SwapRouter runtime hash embeds this WETH immutable, so the plan is bound to Uniswap's Sepolia WETH.
	const wethAddress = SEPOLIA_NETWORK_PROFILE.wethAddress
	const expectedPublishedAddresses: Readonly<Record<PublishedContractId, Address>> = { uniswapV3Factory: uniswapV3FactoryAddress, uniswapV3Quoter: uniswapV3QuoterAddress, uniswapV4PoolManager: uniswapV4PoolManagerAddress, uniswapV4Quoter: uniswapV4QuoterAddress, weth: wethAddress }
	const publishedContracts = (['weth', 'uniswapV3Factory', 'uniswapV3Quoter', 'uniswapV4PoolManager', 'uniswapV4Quoter'] as const).map((id): PublishedContract => {
		const record = artifacts.sepoliaPublished[id]
		if (record.address !== expectedPublishedAddresses[id]) throw new Error(`Vendored ${id} address ${record.address} does not match the published address ${expectedPublishedAddresses[id]}`)
		return { ...record, id, label: PUBLISHED_CONTRACT_LABELS[id] }
	})
	const v3SwapRouterInitCode = encodeDeployData({
		abi: TWO_ADDRESS_CONSTRUCTOR_ABI,
		args: [uniswapV3FactoryAddress, wethAddress],
		bytecode: artifacts.uniswapV3SwapRouter,
	})
	const uniswapV3SwapRouterAddress = deterministicAddress(v3SwapRouterInitCode)

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
		publishedContracts,
		steps: [
			{
				address: ARACHNID_CREATE2_DEPLOYER_ADDRESS,
				dependencies: [],
				deploy: async client => await deployArachnidCreate2Deployer(client, wait),
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
				address: uniswapV3SwapRouterAddress,
				dependencies: ['proxyDeployer'],
				deploy: async client => await deployViaProxy(client, v3SwapRouterInitCode),
				expectedRuntimeCodeHash: SEPOLIA_SWAP_ROUTER_RUNTIME_CODE_HASH,
				id: 'uniswapV3SwapRouter',
				label: 'Uniswap V3 SwapRouter',
			},
		],
	}
}
