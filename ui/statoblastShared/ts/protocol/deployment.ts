import { deploymentErrors } from '../copy/protocolErrors.js'
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
	securityPoolModuleDeployments,
	getQuestionLedgerOperationsDelegateByteCode,
	getQuestionLedgerOperationsDelegateRuntimeCode,
	getQuestionLedgerAccountingModuleByteCode,
	getQuestionLedgerAccountingModuleRuntimeCode,
	getShareTokenFactoryByteCode,
} from './deploymentHelpers.js'
import { DeploymentStatusOracle_DeploymentStatusOracle } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate, statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import { constructorArgumentsFromInitCode, createDeploymentStatusOracleAddressHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from './deploymentHelpers.js'

export { loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'

export const EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameDepositDelegate: '0x64c4eaa617bc1ae029805c959024ae025386fdfbcd09dc0d74011990c203f9ec',
	escalationGameFactory: '0xf710c067640e4c7f706bea4ecb4874b46be648a6d720be3f327d3441f4729b43',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	sharedPoolPriceFeedFactory: '0xa7a196851b5a3d1ea31ad8bb1cecfa5aa5d96ecce18f595e9a3468d4728f97d2',
	questionLedgerEventEmitter: '0x7cc076e2822ad2187a680ab7b091a7a93963fa5c07bf31be029b9ea90dcd5b46',
	securityPoolFactory: '0x41af5d7461b3a7e258144182adff5f8695218d4d2b63a37ed42b1a4d08ccb2d2',
	questionForker: '0xdbda564ee210faa59b6c560007ebf746200d925872b66370f3d886b58c2e580f',
	questionLedgerOperationsDelegate: '0x70efd3ecf075e48d3f86f51d9b7480e6512d8d034f016a0f50b72223ad820d1c',
	shareTokenFactory: '0x089a5dab4a1c2d40708c99377b268198df60c88997c30697ca30af544ca638ff',
	sharedPoolPriceFeedDeploymentWorker: '0x7ac8b37749ae70c9b68310b44cf06df2e78f1eeff5d0b5074c108b8dc5bc2571',
}

const EXPECTED_NO_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0xaff9c1be1f92897db0663b7b4a615066122017979155fac92ced77442feee1c6',
	questionForker: '0x297b4ffe0e4dec3a131c530712f0b6b512086785ed95d27692ddba82ea26ea5a',
	shareTokenFactory: '0x1b808215bdd549826201607b4f027bbc2b93385050c84bf1ee7fee8e0f427059',
}

function runtimeWithAddresses(artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }, addresses: readonly Address[]) {
	const groups = Object.values(artifact.evm.deployedBytecode.immutableReferences)
	if (groups.length !== addresses.length) throw new Error(deploymentErrors.contractCodeInvalid)
	const code = hexToBytes(`0x${artifact.evm.deployedBytecode.object}`)
	for (const [index, group] of groups.entries()) {
		const address = addresses[index]
		if (address === undefined) throw new Error(deploymentErrors.contractAddressMissing)
		const padded = hexToBytes(toHex(hexToBytes(address), { size: 32 }))
		for (const reference of group) {
			if (reference.length !== 32 || code.slice(reference.start, reference.start + reference.length).some(byte => byte !== 0)) throw new Error(deploymentErrors.contractCodeInvalid)
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
		if (chunkDeployer === undefined) throw new Error(deploymentErrors.libraryLayoutMissing)
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
		if (chunkDeployer === undefined) throw new Error(deploymentErrors.libraryLayoutMissing)
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
	sharedPoolPriceFeedFactory: '0xf29cec57195acdaa5473b1ea115739ccf880f7058748e5f46799e6b92e6a5ff2',
	questionLedgerEventEmitter: '0x7cc076e2822ad2187a680ab7b091a7a93963fa5c07bf31be029b9ea90dcd5b46',
	securityPoolFactory: '0x94a2ea13a97e254cf6e0df0caa9dbe7d94319717399eaeaf9ee90eb08742abec',
	questionForker: '0x939b31e1335bb9c5678533a848f5f9b657d85bde85ce9719145ee0c79a2bc10f',
	questionLedgerOperationsDelegate: '0x70efd3ecf075e48d3f86f51d9b7480e6512d8d034f016a0f50b72223ad820d1c',
	shareTokenFactory: '0x8325a085bc2cdc9b1645bd1a3adc60e432c58fbd81b81e072c599c75e9c757bb',
	sharedPoolPriceFeedDeploymentWorker: '0x7ac8b37749ae70c9b68310b44cf06df2e78f1eeff5d0b5074c108b8dc5bc2571',
}

const EXPECTED_NO_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_MAINNET_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0xeaa252c363284be5fdb2932153244b7af08b8a2caa9838f748f3ededf591f693',
	questionForker: '0xea60e3dab10e3c08c98da5f8fcdd031ae6e09b8589c1f53bd3769fdd96c67e75',
	shareTokenFactory: '0x015de109f5c2301c2a78f433bfde2c6724d59d5a09faffa305930e19d8a670cf',
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
			id: 'questionForker',
			label: 'QuestionForker',
			address: addresses.questionForker,
			dependencies: ['proxyDeployer', 'zoltar'],
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
	if (oracleStep === undefined) throw new Error(deploymentErrors.statusCheckMissing)
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
