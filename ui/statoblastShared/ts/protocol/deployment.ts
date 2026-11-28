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
	getQuestionLedgerDelegateByteCode,
	getQuestionLedgerDelegateRuntimeCode,
	getShareTokenFactoryByteCode,
} from './deploymentHelpers.js'
import { DeploymentStatusOracle_DeploymentStatusOracle } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate, statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import { constructorArgumentsFromInitCode, createDeploymentStatusOracleAddressHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from './deploymentHelpers.js'

export { loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'

export const EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameDepositDelegate: '0x659497e6d93346c59b4981d0647156cfa916cd5065992b77bc68421198a8875c',
	escalationGameFactory: '0x456afa4d6332c5576611e29f2afd43707dd13c176fd673ff01991d5ff2177341',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	sharedPoolPriceFeedFactory: '0x2ac2ade4dd28a2d5f5e8c672d5dfc366d29caff6f3f34258dd28cea3fb556dbe',
	securityPoolFactory: '0x28964a50ca4adda5b2b648f9da86df31ed53f70163cf73a89fb216c9cbb359f8',
	questionForker: '0x792a720ce6f619533d91592c1f134bf15d42ae76d799286486b193f6a770fcd2',
	questionLedgerDelegate: '0xbd4a57b7e3ba1737aee3ec9baf045c78d89e5176a5794946aa7c78b60c51f45a',
	shareTokenFactory: '0xc3ec04abafb50d3006ad4fdcc12ad6db5cc1fc9e73df30ac78b2c11ee7a221c8',
	sharedPoolPriceFeedDeploymentWorker: '0x7354bdbb4f232a00450ed0fb11bfb4b3c6c248bb219d843a2e76314cab28e449',
}

const EXPECTED_NO_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0x2da500888f9f9ec193cab161f8f8849f3946e33592a21b5606751b20aae80ae7',
	questionForker: '0xf619bf5b092e42d1e9ff4b76f770da642e3be7ebac53ed00552b4d8c8aaaa93d',
	shareTokenFactory: '0x9f22f623c7d4d5ad77e997fa34af321389d61ffc3d59cea28b3f9a7656ad2915',
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
	questionLedgerDelegate: getQuestionLedgerDelegateRuntimeCode(),
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
	escalationGameDepositDelegate: '0x659497e6d93346c59b4981d0647156cfa916cd5065992b77bc68421198a8875c',
	escalationGameFactory: '0x456afa4d6332c5576611e29f2afd43707dd13c176fd673ff01991d5ff2177341',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	sharedPoolPriceFeedFactory: '0x4f8ffac7b70998f2c5a65bf8968d016951312d113cee84f53b8f0f2a84ee78b8',
	securityPoolFactory: '0x5358c8ffa652aca055e1b0a2c6791f8f67d4343f082e23c59b4f6c8241334b0b',
	questionForker: '0x1764159cabc779180ecf716791eae181788aa89059271a9a2ca74ea4f315a0cd',
	questionLedgerDelegate: '0xbd4a57b7e3ba1737aee3ec9baf045c78d89e5176a5794946aa7c78b60c51f45a',
	shareTokenFactory: '0xd97cbc2aa07103d3b52aa5236803ca1fd0f14516243e4d352fb0c9eb509bf114',
	sharedPoolPriceFeedDeploymentWorker: '0x7354bdbb4f232a00450ed0fb11bfb4b3c6c248bb219d843a2e76314cab28e449',
}

const EXPECTED_NO_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_MAINNET_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0x67888b2b24160dedf6af4f351ddd2acdde6c750dd9f5a6aaf3f12f6d6ce95f56',
	questionForker: '0xe280af0716ba5eb9084efbb928c8a7c0af8c0d16c6b4f0c906e915e80fa7a1bd',
	shareTokenFactory: '0x3568bddd1df5d4b859574ef220eea87d5957a88c20eaba1290a15ac6cbdf1903',
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
			id: 'questionLedgerDelegate',
			label: deploymentCopy.questionLedgerDelegateContract,
			address: addresses.questionLedgerDelegate,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getQuestionLedgerDelegateByteCode()),
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
			dependencies: ['proxyDeployer', 'questionForker', 'questionLedgerDelegate', 'zoltarQuestionData', 'escalationGameFactory', 'openOracle', 'zoltar', 'shareTokenFactory', 'sharedPoolPriceFeedFactory'],
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
		addresses.questionLedgerDelegate,
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
