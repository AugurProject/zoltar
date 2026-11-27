import * as deploymentCopy from '../copy/deployment.js'
import { deploymentErrors } from '../copy/protocolErrors.js'
import { questionDataContract, universeContract } from '../copy/app.js'
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
	escalationGameFactory: '0x387f41646d6a424dc8a500b45315ab422969aa19e2a9acf0661906ef21bd8acd',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	sharedPoolPriceFeedFactory: '0xb73435a3cce3ce807c3106c927b8ab75ea13be4331a6e0d377d3c8a38aae205f',
	questionLedgerEventEmitter: '0x7cc076e2822ad2187a680ab7b091a7a93963fa5c07bf31be029b9ea90dcd5b46',
	securityPoolFactory: '0x802715b54c53b1f2ab2053cbc9ac280ee3e3abc08a5ca12baf4a0604ec049a87',
	questionForker: '0xb943c51de2f1dfb06aef9404c0d9966fbb9aa76664f2d82fa63a5e6f4255ec39',
	questionLedgerOperationsDelegate: '0x70efd3ecf075e48d3f86f51d9b7480e6512d8d034f016a0f50b72223ad820d1c',
	shareTokenFactory: '0x5d36307371a5737f98c283875104baa32da56c9a035e6d8bea8f90565d345eb0',
	sharedPoolPriceFeedDeploymentWorker: '0xb8c41903a37d46594037683b5f3aab725f68469fefd20f63c3f407e41e49d3ec',
}

const EXPECTED_NO_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0xf3e709b069ff3629431e5ec1908b439281892f4d641e6d3c3984844b00f8f957',
	questionForker: '0x264856bf82d587a858c772b8b7157495f3115d9e9453a02d19654f6770c4f1a9',
	shareTokenFactory: '0x455b37ed5b6e81f95dc8f7d0820f7d53d13738634e28fe21cf1d2973d5f7c10f',
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
	escalationGameFactory: '0x387f41646d6a424dc8a500b45315ab422969aa19e2a9acf0661906ef21bd8acd',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	sharedPoolPriceFeedFactory: '0x4d73909e89ec06f2a851a21ae9a6621981a8528469b6e0592c07a8559a8f853c',
	questionLedgerEventEmitter: '0x7cc076e2822ad2187a680ab7b091a7a93963fa5c07bf31be029b9ea90dcd5b46',
	securityPoolFactory: '0xf6967ec0da0d1966c6515de26c64cd2c828529241197acd3ef7fbb1b059e350a',
	questionForker: '0x7efa736bc98b0f7b5d9509444128d978d790c3bd8a956762be8d617803f4b686',
	questionLedgerOperationsDelegate: '0x70efd3ecf075e48d3f86f51d9b7480e6512d8d034f016a0f50b72223ad820d1c',
	shareTokenFactory: '0x1655d4e1bf272dd2e2bc32d38ba9a8d59a48ad0b59af85903158fda48fbe1532',
	sharedPoolPriceFeedDeploymentWorker: '0xb8c41903a37d46594037683b5f3aab725f68469fefd20f63c3f407e41e49d3ec',
}

const EXPECTED_NO_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_MAINNET_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0x17a1c58b0d51e1f57578b7192c2b5c97f9bbb241ec2968c26d2a504c862fd27c',
	questionForker: '0x59d35895876398c2c1a5c365a685119bcdcbfb027d4842d98bdf8054e2a24ce9',
	shareTokenFactory: '0x1f5876886ea35c0073eca2754f24d6d375c6e73706337a9868c2eebeb67a0e0f',
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
		...getZoltarDeploymentSteps(profile, wait).map(step => {
			if (step.id === 'zoltar') return { ...step, label: universeContract }
			if (step.id === 'zoltarQuestionData') return { ...step, label: questionDataContract }
			if (step.id !== 'deploymentStatusOracle') return step
			return {
				...step,
				address: getDeploymentStatusOracleAddress(profile),
				deploy: async (client: WriteClient) => await deployViaProxy(client, getDeploymentStatusOracleByteCode(profile)),
			}
		}),

		{
			id: 'questionLedgerOperationsDelegate',
			label: deploymentCopy.questionActionsContract,
			address: addresses.questionLedgerOperationsDelegate,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getQuestionLedgerOperationsDelegateByteCode()),
		},
		{
			id: 'questionLedgerEventEmitter',
			label: deploymentCopy.questionBalancesContract,
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
			label: deploymentCopy.shareTokenDeploymentContract,
			address: addresses.shareTokenFactory,
			dependencies: ['proxyDeployer', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getShareTokenFactoryByteCode(addresses.zoltar)),
		},
		{
			id: 'sharedPoolPriceFeedDeploymentWorker',
			label: deploymentCopy.priceFeedDeploymentSupport,
			address: addresses.sharedPoolPriceFeedDeploymentWorker,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getSharedPoolPriceFeedDeploymentWorkerByteCode()),
		},
		{
			id: 'sharedPoolPriceFeedFactory',
			label: deploymentCopy.priceFeedDeploymentContract,
			address: addresses.sharedPoolPriceFeedFactory,
			dependencies: ['proxyDeployer', 'sharedPoolPriceFeedDeploymentWorker'],
			deploy: async client => await deployViaProxy(client, getSharedPoolPriceFeedFactoryByteCode(profile.wethAddress)),
		},
		{
			id: 'questionForker',
			label: deploymentCopy.forkContract,
			address: addresses.questionForker,
			dependencies: ['proxyDeployer', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getQuestionForkerByteCode(addresses.zoltar)),
		},
		{
			id: 'escalationGameDepositDelegate',
			label: deploymentCopy.reportingDepositsContract,
			address: addresses.escalationGameDepositDelegate,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.evm.bytecode.object}`),
		},
		{
			id: 'escalationGameFactory',
			label: deploymentCopy.reportingGameDeploymentContract,
			address: addresses.escalationGameFactory,
			dependencies: ['proxyDeployer', 'escalationGameDepositDelegate'],
			deploy: async client => await deployViaProxy(client, getEscalationGameFactoryByteCode(addresses.escalationGameDepositDelegate)),
		},
		{
			id: 'securityPoolFactory',
			label: deploymentCopy.poolDeploymentContract,
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

export function getStatoblastUiDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile()) {
	const labels: Partial<Record<DeploymentStepId, string>> = {
		reputationToken: deploymentCopy.genesisRepToken,
		deploymentStatusOracle: deploymentCopy.deploymentStatusContract,
		multicall3: deploymentCopy.batchReadContract,
	}
	return getDeploymentSteps(profile).map(step => {
		const label = labels[step.id] ?? step.label
		return { ...step, label, verificationLabel: label }
	})
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
	const steps = getStatoblastUiDeploymentSteps(profile)
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
