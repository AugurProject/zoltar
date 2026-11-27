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
	escalationGameFactory: '0x1c13a21f4acc73aa9da1acf73c490eb71e6c1b03c72a920d284baa61fc9afe78',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	sharedPoolPriceFeedFactory: '0x16ee07675aa76a9aa9a06852ce00dda8f9b9890b6b00be02aab6d06356148c88',
	questionLedgerEventEmitter: '0x7cc076e2822ad2187a680ab7b091a7a93963fa5c07bf31be029b9ea90dcd5b46',
	securityPoolFactory: '0x0a671e6529146a8b238f7814cf84d54d438b6afe515238c80d16ef95062a23dc',
	questionForker: '0x6610a5b8c1120a2ecca1113088a66016462c8b0409b6f1f812b53848a4da9b49',
	questionLedgerOperationsDelegate: '0x70efd3ecf075e48d3f86f51d9b7480e6512d8d034f016a0f50b72223ad820d1c',
	shareTokenFactory: '0xd44087884c5643571f83cfbabb765c1a3565811503d843814033600de4f3153e',
	sharedPoolPriceFeedDeploymentWorker: '0x109cf23efc102bf1d30696b5691e541d98947ece38bb0ca24d01dfa8d61d48e4',
}

const EXPECTED_NO_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0xd58d611b8ec12a24c7e6f1c3fe28fe51976ba9f2d8a5bec7a800e0fa8ccd6e25',
	questionForker: '0x691ce6557abb8faee5809a535c9c3a6a6ae03bf9cc4570646eb97fa930ddec50',
	shareTokenFactory: '0xd416a451237e0c82a4a1c9c3bea86f81a2fe6cd203d37e5434422f09541275de',
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
	// The auction deployer stores only its two creation-code chunks. Immutable groups follow AST ids, which depend on source
	// file order, so the chunks are placed by the ids of the shared CreationCodeDeployer immutables instead of by position.
	if (module.id === 'securityPoolRepairAuctionDeployer') {
		const chunkDeployer = securityPoolModuleDeployments.find(candidate => candidate.id === 'securityPoolForkCoordinatorDeployer')
		if (chunkDeployer === undefined) throw new Error(deploymentErrors.libraryLayoutMissing)
		const chunkIds = Object.keys(chunkDeployer.artifact.evm.deployedBytecode.immutableReferences)
		return runtimeWithAddresses(
			module.artifact,
			Object.keys(module.artifact.evm.deployedBytecode.immutableReferences).map(id => {
				const index = chunkIds.indexOf(id)
				if (index < 0) throw new Error('Unexpected auction creation-code address')
				return getCreateAddress({ from: addresses[module.id], nonce: BigInt(index + 1) })
			}),
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
	escalationGameFactory: '0x1c13a21f4acc73aa9da1acf73c490eb71e6c1b03c72a920d284baa61fc9afe78',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	sharedPoolPriceFeedFactory: '0xd27571dc83c792cc0f5b9e883c5d0040df49583f36dd80f6ad9ee209fb26f793',
	questionLedgerEventEmitter: '0x7cc076e2822ad2187a680ab7b091a7a93963fa5c07bf31be029b9ea90dcd5b46',
	securityPoolFactory: '0xd2a6e565cdbb9b393119734a105bc7929b80da9a974f05b3a4f71e917001291c',
	questionForker: '0xf218609efbbee335015f68e52242558cfe2694f24691fb6a51572ccba695cf4c',
	questionLedgerOperationsDelegate: '0x70efd3ecf075e48d3f86f51d9b7480e6512d8d034f016a0f50b72223ad820d1c',
	shareTokenFactory: '0x4ca719641cc8fd77aa0f41adcaa4e03a48561bcef8c76841d02979eb8e86f8c9',
	sharedPoolPriceFeedDeploymentWorker: '0x109cf23efc102bf1d30696b5691e541d98947ece38bb0ca24d01dfa8d61d48e4',
}

const EXPECTED_NO_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_MAINNET_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0x0608d023257063e679885c823a8cf42eba722bdba1d82e04e41ebec8de0f5090',
	questionForker: '0x349de1c29e5c7c965096d8cc7146ba80f75cc87df6c0a65db9f85f4a85653ae4',
	shareTokenFactory: '0x20a8c7380eacec48e3fad622cc45367b37d50f8336e4177325d1aea92d11b39e',
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
