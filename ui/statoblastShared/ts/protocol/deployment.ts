import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getRuntimeNetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { bytesToHex, encodeDeployData, getCreateAddress, hexToBytes, keccak256, toHex, type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { DeploymentStatusSnapshot, DeploymentStep, DeploymentStepId, ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import {
	assertDeploymentStepRuntimeCode,
	assertStaticDeploymentArtifactRuntimeCodeHashes,
	buildDeploymentStatusSnapshot,
	deployViaProxy,
	getDeploymentSteps as getZoltarDeploymentSteps,
	getZoltarDeploymentStatusOracleStepAddresses,
	getZoltarDeploymentStepConstructorArguments,
	loadDeploymentStatusOracleMaskAtAddress,
	loadDeploymentStatusSnapshotFromCode,
	withExpectedDeploymentRuntimeCodeHashes,
} from '@zoltar/ui-zoltar-shared/protocol/deployment.js'
import {
	getInfraContractAddresses,
	getEscalationGameFactoryByteCode,
	getInfraStepConstructorArguments,
	getSharedPoolPriceFeedFactoryByteCode,
	getSharedPoolPriceFeedDeploymentWorkerByteCode,
	getSecurityPoolFactoryByteCode,
	getQuestionForkerByteCode,
	getQuestionForkerDelegateByteCode,
	securityPoolModuleDeployments,
	getQuestionLedgerOperationsDelegateByteCode,
	getQuestionLedgerOperationsDelegateRuntimeCode,
	getQuestionLedgerAccountingModuleByteCode,
	getQuestionLedgerAccountingModuleRuntimeCode,
	getShareTokenFactoryByteCode,
} from './deploymentHelpers.js'
import { DeploymentStatusOracle_DeploymentStatusOracle } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate, statoblast_QuestionForkerDelegate_QuestionForkerDelegate as nativeSecurityPoolForkArtifact, statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import { constructorArgumentsFromInitCode, createDeploymentStatusOracleAddressHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from './deploymentHelpers.js'

export { loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'

export const EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameDepositDelegate: '0x64c4eaa617bc1ae029805c959024ae025386fdfbcd09dc0d74011990c203f9ec',
	escalationGameFactory: '0xf710c067640e4c7f706bea4ecb4874b46be648a6d720be3f327d3441f4729b43',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	sharedPoolPriceFeedFactory: '0xda97ea97286d4a3e6d17d85de3149c545e85135f5b49694e5e7a5506572dd7c9',
	questionLedgerEventEmitter: '0x7cc076e2822ad2187a680ab7b091a7a93963fa5c07bf31be029b9ea90dcd5b46',
	securityPoolFactory: '0x833a35d7fb78787e75f9b8d2c792ac1ecab8210d19cd494f718b2b2b2a441096',
	questionForker: '0xa8f5dd7bbff3bd21d994f5f29d1fa8e5bf59c689bd01b4a254167d19b140b5ce',
	questionLedgerOperationsDelegate: '0x70efd3ecf075e48d3f86f51d9b7480e6512d8d034f016a0f50b72223ad820d1c',
	shareTokenFactory: '0x0162cac38fed27cd31bf07f99bf25d64eb00da71767a58031bb30071b83c8016',
	sharedPoolPriceFeedDeploymentWorker: '0x981ed15a29deef8f62c034ffad1f209310551f75ce565f7e87960225fd68c117',
}

const EXPECTED_NO_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0xf8a5199c4a87d6756be5f2da5b7c41cf9f207534bb40f938da11a7562ac4a7a3',
	questionForker: '0xdd07c37f4c22075a3c475329e73c890e528498fdaf37f42b46e8a9a10a265278',
	shareTokenFactory: '0x57c6b60e55a71a3431da3d4db66483f56ea65cc7018e4b69320d8d543dbd054e',
}

function runtimeWithAddresses(artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }, addresses: readonly Address[]) {
	const groups = Object.values(artifact.evm.deployedBytecode.immutableReferences)
	if (groups.length !== addresses.length) throw new Error(`Unexpected deployment immutable layout: ${groups.length.toString()} immutables, ${addresses.length.toString()} addresses, runtime ${artifact.evm.deployedBytecode.object.length.toString()} characters`)
	const code = hexToBytes(`0x${artifact.evm.deployedBytecode.object}`)
	for (const [index, group] of groups.entries()) {
		const address = addresses[index]
		if (address === undefined) throw new Error('Missing deployment immutable')
		const padded = hexToBytes(toHex(hexToBytes(address), { size: 32 }))
		for (const reference of group) {
			if (reference.length !== 32 || code.slice(reference.start, reference.start + reference.length).some(byte => byte !== 0)) throw new Error('Unexpected deployment immutable bytes')
			code.set(padded, reference.start)
		}
	}
	return bytesToHex(code)
}
function moduleRuntimeCode(module: (typeof securityPoolModuleDeployments)[number], addresses: ReturnType<typeof getInfraContractAddresses>) {
	if (module.id === 'securityPoolCommitmentIndexDeployer') return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n })])
	if (module.id === 'securityPoolCapitalFeeStreamsDeployer' || module.id === 'securityPoolServicesDeployer' || module.id === 'securityPoolSettlementBookDeployer')
		return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n })])
	if (module.id === 'securityPoolForkCoordinatorDeployer') return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n })])
	if (module.id === 'securityPoolCapitalLedgerDeployer') {
		const chunkDeployer = securityPoolModuleDeployments.find(candidate => candidate.id === 'securityPoolForkCoordinatorDeployer')
		if (chunkDeployer === undefined) throw new Error('Missing creation-code chunk deployer layout')
		const chunkIds = Object.keys(chunkDeployer.artifact.evm.deployedBytecode.immutableReferences)
		return runtimeWithAddresses(
			module.artifact,
			Object.keys(module.artifact.evm.deployedBytecode.immutableReferences).map(id => getCreateAddress({ from: addresses[module.id], nonce: BigInt(chunkIds.indexOf(id) < 0 ? 3 : chunkIds.indexOf(id) + 1) })),
		)
	}
	// The auction deployer also publishes the shared vault implementation after its two creation-code chunks. Immutable
	// groups follow AST ids, which depend on source file order, so the chunks are placed by the ids of the shared
	// SecurityPoolCreationCodeDeployer immutables instead of by position.
	if (module.id === 'securityPoolRepairAuctionDeployer') {
		const chunkDeployer = securityPoolModuleDeployments.find(candidate => candidate.id === 'securityPoolForkCoordinatorDeployer')
		if (chunkDeployer === undefined) throw new Error('Missing creation-code chunk deployer layout')
		const chunkIds = Object.keys(chunkDeployer.artifact.evm.deployedBytecode.immutableReferences)
		const chunkAddresses = [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n })]
		const vaultImplementation = getCreateAddress({ from: addresses[module.id], nonce: 3n })
		return runtimeWithAddresses(
			module.artifact,
			Object.keys(module.artifact.evm.deployedBytecode.immutableReferences).map(id => chunkAddresses[chunkIds.indexOf(id)] ?? vaultImplementation),
		)
	}
	return runtimeWithAddresses(module.artifact, [])
}

const STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID = {
	escalationGameDepositDelegate: `0x${statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.evm.deployedBytecode.object}`,
	openOracle: `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.deployedBytecode.object}`,
	questionLedgerOperationsDelegate: getQuestionLedgerOperationsDelegateRuntimeCode(),
	questionLedgerEventEmitter: getQuestionLedgerAccountingModuleRuntimeCode(),
} satisfies Readonly<Partial<Record<DeploymentStepId, Hex>>>

export function assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes(
	parameters: Parameters<typeof assertStaticDeploymentArtifactRuntimeCodeHashes>[0] = {
		expectedRuntimeCodeHashes: EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
		runtimeCodeByStepId: STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID,
	},
) {
	return assertStaticDeploymentArtifactRuntimeCodeHashes(parameters)
}

const EXPECTED_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameDepositDelegate: '0x64c4eaa617bc1ae029805c959024ae025386fdfbcd09dc0d74011990c203f9ec',
	escalationGameFactory: '0xf710c067640e4c7f706bea4ecb4874b46be648a6d720be3f327d3441f4729b43',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	sharedPoolPriceFeedFactory: '0x40305ebc3097ec02388f4c05a12fa248462aa44c2de0c2d7eb3d05e60da2c9ec',
	questionLedgerEventEmitter: '0x7cc076e2822ad2187a680ab7b091a7a93963fa5c07bf31be029b9ea90dcd5b46',
	securityPoolFactory: '0x8d001ff88eb1c87b4de12d2189dcf686924112ff972ae38b41f1c8a5c0795a75',
	questionForker: '0x6512465f531042b6c07329e2ba2f31df5d02df9c25d17ee2df63ba386702ab11',
	questionLedgerOperationsDelegate: '0x70efd3ecf075e48d3f86f51d9b7480e6512d8d034f016a0f50b72223ad820d1c',
	shareTokenFactory: '0x37365891adc20f8d1e8469131cefa8a188c90ea1b93cec3981eae68a9aca4751',
	sharedPoolPriceFeedDeploymentWorker: '0x981ed15a29deef8f62c034ffad1f209310551f75ce565f7e87960225fd68c117',
}

const EXPECTED_NO_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_MAINNET_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0xdc715d54ae001c79d1f2d1c07c89ae49f68e2abee8ce156ab5359799155b6911',
	questionForker: '0xf69d1b1ba928e6b0609d91579fa1ba9d1f36ebfbff789ce2d4ae5d4841ba785c',
	shareTokenFactory: '0x409ed0e9dbe9fc6277b1bc9c6653bbce9ddd75f4b33a3722520e65583fd3e3a7',
}
const EXPECTED_PUBLIC_RUNTIME_CODE_HASHES = {
	mainnet: { yes: EXPECTED_MAINNET_RUNTIME_CODE_HASHES, no: EXPECTED_NO_MAINNET_RUNTIME_CODE_HASHES },
	sepolia: { yes: EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES, no: EXPECTED_NO_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES },
}

export function getDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile(), wait?: Parameters<typeof getZoltarDeploymentSteps>[1]): DeploymentStep[] {
	const addresses = getInfraContractAddresses(profile)
	const expectedRuntimeCodeHashes = profile.id === 'simulation' ? undefined : EXPECTED_PUBLIC_RUNTIME_CODE_HASHES[profile.id][profile.genesisOutcome]
	const steps: DeploymentStep[] = [
		// Statoblast replaces the deployment status oracle step: the statoblast oracle
		// must monitor additional Statoblast contracts, so it is deployed with
		// a different constructor argument list (and therefore a different address).
		...getZoltarDeploymentSteps(profile, wait).map(step =>
			step.id === 'deploymentStatusOracle'
				? {
						...step,
						address: getDeploymentStatusOracleAddress(profile),
						deploy: async (client: WriteClient) => await deployViaProxy(client, getDeploymentStatusOracleByteCode(profile)),
					}
				: step,
		),

		{
			id: 'questionLedgerOperationsDelegate',
			label: 'QuestionLedgerOperationsDelegate',
			address: addresses.questionLedgerOperationsDelegate,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getQuestionLedgerOperationsDelegateByteCode()),
		},
		{
			id: 'questionLedgerEventEmitter',
			label: 'QuestionLedgerAccountingModule',
			address: addresses.questionLedgerEventEmitter,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getQuestionLedgerAccountingModuleByteCode()),
		},
		{
			id: 'openOracle',
			label: 'OpenOracle',
			address: addresses.openOracle,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`),
		},
		{
			id: 'shareTokenFactory',
			label: 'ShareTokenFactory',
			address: addresses.shareTokenFactory,
			dependencies: ['proxyDeployer', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getShareTokenFactoryByteCode(addresses.zoltar)),
		},
		{
			id: 'sharedPoolPriceFeedDeploymentWorker',
			label: 'SharedPoolPriceFeedDeploymentWorker',
			address: addresses.sharedPoolPriceFeedDeploymentWorker,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getSharedPoolPriceFeedDeploymentWorkerByteCode()),
		},
		{
			id: 'sharedPoolPriceFeedFactory',
			label: 'SharedPoolPriceFeedFactory',
			address: addresses.sharedPoolPriceFeedFactory,
			dependencies: ['proxyDeployer', 'sharedPoolPriceFeedDeploymentWorker'],
			deploy: async client => await deployViaProxy(client, getSharedPoolPriceFeedFactoryByteCode(profile.wethAddress)),
		},
		{
			id: 'questionForkerDelegate',
			label: 'QuestionForkerDelegate',
			address: addresses.questionForkerDelegate,
			dependencies: ['proxyDeployer', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getQuestionForkerDelegateByteCode(addresses.zoltar)),
			expectedRuntimeCodeHash: keccak256(runtimeWithAddresses(nativeSecurityPoolForkArtifact, [addresses.zoltar])),
		},
		{
			id: 'questionForker',
			label: 'QuestionForker',
			address: addresses.questionForker,
			dependencies: ['proxyDeployer', 'zoltar', 'questionForkerDelegate'],
			deploy: async client => await deployViaProxy(client, getQuestionForkerByteCode(addresses.zoltar)),
		},
		{
			id: 'escalationGameDepositDelegate',
			label: 'EscalationGameDepositDelegate',
			address: addresses.escalationGameDepositDelegate,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.evm.bytecode.object}`),
		},
		{
			id: 'escalationGameFactory',
			label: 'EscalationGameFactory',
			address: addresses.escalationGameFactory,
			dependencies: ['proxyDeployer', 'escalationGameDepositDelegate'],
			deploy: async client => await deployViaProxy(client, getEscalationGameFactoryByteCode(addresses.escalationGameDepositDelegate)),
		},
		{
			id: 'securityPoolFactory',
			label: 'SecurityPoolFactory',
			address: addresses.securityPoolFactory,
			dependencies: ['proxyDeployer', 'questionForker', 'questionLedgerOperationsDelegate', 'questionLedgerEventEmitter', 'zoltarQuestionData', 'escalationGameFactory', 'openOracle', 'zoltar', 'shareTokenFactory', 'sharedPoolPriceFeedFactory'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolFactoryByteCode(addresses)),
		},
		...securityPoolModuleDeployments.map(
			module =>
				({
					id: module.id,
					label: module.label,
					address: addresses[module.id],
					dependencies: ['proxyDeployer'],
					deploy: async (client: WriteClient) => await deployViaProxy(client, module.bytecode()),
					expectedRuntimeCodeHash: keccak256(moduleRuntimeCode(module, addresses)),
				}) satisfies DeploymentStep,
		),
	]
	return withExpectedDeploymentRuntimeCodeHashes(steps, profile).map(step => ({
		...step,
		...(expectedRuntimeCodeHashes?.[step.id] === undefined ? {} : { expectedRuntimeCodeHash: expectedRuntimeCodeHashes[step.id] }),
	}))
}

/**
 * Constructor arguments for every proxy-deployed step in the statoblast
 * deployment plan, keyed by step id. The statoblast deployment status oracle
 * monitors additional contracts, so its arguments replace the zoltar entry.
 * Consumed through a dynamic import by the deployment manifest generator
 * (tooling/contracts/check-mainnet-deployment.mts), which Knip cannot trace.
 * @public
 */
export function getDeploymentStepConstructorArguments(profile: NetworkProfile = getRuntimeNetworkProfile()): Partial<Record<DeploymentStepId, string>> {
	return {
		...getZoltarDeploymentStepConstructorArguments(profile),
		...getInfraStepConstructorArguments(profile),
		deploymentStatusOracle: constructorArgumentsFromInitCode(getDeploymentStatusOracleByteCode(profile), DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object),
	}
}

function getStatoblastDeploymentStatusOracleStepAddresses(profile = getRuntimeNetworkProfile()): Address[] {
	const addresses = getInfraContractAddresses(profile)
	return [
		...getZoltarDeploymentStatusOracleStepAddresses(profile),
		addresses.questionLedgerOperationsDelegate,
		addresses.questionLedgerEventEmitter,
		addresses.openOracle,
		addresses.shareTokenFactory,
		addresses.sharedPoolPriceFeedDeploymentWorker,
		addresses.sharedPoolPriceFeedFactory,
		addresses.questionForkerDelegate,
		addresses.questionForker,
		addresses.escalationGameDepositDelegate,
		addresses.escalationGameFactory,
		addresses.securityPoolFactory,
		...securityPoolModuleDeployments.map(module => addresses[module.id]),
	] satisfies Address[]
}

function getDeploymentStatusOracleByteCode(profile = getRuntimeNetworkProfile()): Hex {
	return encodeDeployData({
		abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
		bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
		args: [getStatoblastDeploymentStatusOracleStepAddresses(profile)],
	})
}

function getDeploymentStatusOracleAddress(profile = getRuntimeNetworkProfile()): Address {
	return createDeploymentStatusOracleAddressHelper({
		deploymentStatusOracleBytecode: () => getDeploymentStatusOracleByteCode(profile),
		proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
		zeroSalt: ZERO_SALT,
	}).getDeploymentStatusOracleAddress()
}

export async function loadDeploymentStatusOracleSnapshot(client: Pick<ReadClient, 'readContract' | 'getCode'>): Promise<DeploymentStatusSnapshot> {
	const profile = getRuntimeNetworkProfile()
	const steps = getDeploymentSteps(profile)
	const oracleAddress = getDeploymentStatusOracleAddress(profile)
	const oracleCode = await client.getCode({ address: oracleAddress })
	if (profile.id === 'simulation') {
		if (oracleCode === undefined || oracleCode === '0x') {
			const proxyDeployerCode = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
			return buildDeploymentStatusSnapshot(steps, proxyDeployerCode === undefined || proxyDeployerCode === '0x' ? 0n : 1n, false)
		}
		return buildDeploymentStatusSnapshot(steps, await loadDeploymentStatusOracleMaskAtAddress(client, oracleAddress), true)
	}
	const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
	if (oracleStep === undefined) throw new Error('Deployment plan is missing its deployment status oracle step')
	if (!assertDeploymentStepRuntimeCode(oracleStep, oracleCode)) return await loadDeploymentStatusSnapshotFromCode(client, steps)
	const snapshot = buildDeploymentStatusSnapshot(steps, await loadDeploymentStatusOracleMaskAtAddress(client, oracleAddress), true)
	// The oracle mask only says a step was recorded; a step whose address holds no code is reported as not deployed.
	const deploymentStatuses = await Promise.all(
		snapshot.deploymentStatuses.map(async step => {
			if (!step.deployed || step.id === 'deploymentStatusOracle') return step
			return assertDeploymentStepRuntimeCode(step, await client.getCode({ address: step.address })) ? step : { ...step, deployed: false }
		}),
	)
	return { applicationDeploymentComplete: deploymentStatuses.every(step => step.deployed), deploymentStatuses }
}
