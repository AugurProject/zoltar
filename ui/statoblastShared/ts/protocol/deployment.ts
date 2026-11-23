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
	getOpenOraclePriceCoordinatorFactoryByteCode,
	getPriceCoordinatorDeploymentWorkerByteCode,
	getSharedPoolPriceFeedDeploymentWorkerByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getSecurityPoolForkerPortfolioDelegateByteCode,
	portfolioModuleDeployments,
	getSecurityPoolOperationsDelegateByteCode,
	getSecurityPoolOperationsDelegateRuntimeCode,
	getSecurityPoolEventEmitterByteCode,
	getSecurityPoolEventEmitterRuntimeCode,
	getShareTokenFactoryByteCode,
} from './deploymentHelpers.js'
import { DeploymentStatusOracle_DeploymentStatusOracle } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate, statoblast_SecurityPoolForkerPortfolioDelegate_SecurityPoolForkerPortfolioDelegate as nativePortfolioForkArtifact, statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import { constructorArgumentsFromInitCode, createDeploymentStatusOracleAddressHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from './deploymentHelpers.js'

export { loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'

export const EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameDepositDelegate: '0x17ed611f02d0b2ec0011b5b8295916993ae0acdb4ed900bd65bb0c6220ef3517',
	escalationGameFactory: '0x8cc3eaf46352e4c9645c5f02dcefb6cf3062a5935c90d37183a5c9715c08f42a',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	openOraclePriceCoordinatorFactory: '0xce3489eec49dd4af5816a07928d239685be36fcc5aaf7772aef9cd9ef4644abb',
	priceCoordinatorDeploymentWorker: '0x098071f12c722141ed4ae18b7cfdc94c0b912ac4706cce8c129873809c8abe99',
	securityPoolEventEmitter: '0xd6334e44947bed787f35654d650504061ec1f632f1bf6f7e7370b0e108609e73',
	securityPoolFactory: '0x2441d2317f60a1d13d9ecd2b1c4d5be2ac43cce62baf368dceb1920a9650d47b',
	securityPoolForker: '0xc9a3d08eafdb3287bde16783495107739f74ec61cee42d0558c502a49d11959e',
	securityPoolOperationsDelegate: '0xf36906d0baf47720831d3de59569a335c42978ab78ed3c3c5d534b76f2da157a',
	shareTokenFactory: '0xb4e59e0a622ddd77664750e3273128809f9f9744ccaa882963b8316f9fce2a1a',
	sharedPoolPriceFeedDeploymentWorker: '0x9024e7af6ad294e02cb39e216f8df525280995bd42d02ed52a5a8fc666594278',
}

const EXPECTED_NO_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0x27716f371a0b13584f111f6ff6c90c3111879939a23cd14b5bda507b3e962878',
	securityPoolForker: '0x133643f88a41e79c0a51c9a88a33ca4acb84879a0b51ab92e0b6b5bce9040282',
	shareTokenFactory: '0xb1467ad71de639e786528fe27938faa8293202cdf1dc1bd904f000c73b9da0d7',
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
function moduleRuntimeCode(module: (typeof portfolioModuleDeployments)[number], addresses: ReturnType<typeof getInfraContractAddresses>) {
	if (module.id === 'securityPoolCommitmentIndexDeployer' || module.id === 'securityPoolCapitalFeeStreamsDeployer') return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n })])
	if (module.id === 'securityPoolCapitalLedgerDeployer' || module.id === 'securityPoolPortfolioServicesDeployer' || module.id === 'securityPoolSettlementBookDeployer')
		return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n })])
	if (module.id === 'securityPoolPortfolioForkCoordinatorDeployer') return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n })])
	// The auction deployer also publishes the shared vault implementation after its two creation-code chunks.
	if (module.id === 'securityPoolPortfolioAuctionDeployer') return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n }), getCreateAddress({ from: addresses[module.id], nonce: 3n })])
	return runtimeWithAddresses(module.artifact, [])
}

const STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID = {
	escalationGameDepositDelegate: `0x${statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.evm.deployedBytecode.object}`,
	openOracle: `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.deployedBytecode.object}`,
	securityPoolOperationsDelegate: getSecurityPoolOperationsDelegateRuntimeCode(),
	securityPoolEventEmitter: getSecurityPoolEventEmitterRuntimeCode(),
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
	escalationGameDepositDelegate: '0x17ed611f02d0b2ec0011b5b8295916993ae0acdb4ed900bd65bb0c6220ef3517',
	escalationGameFactory: '0x8cc3eaf46352e4c9645c5f02dcefb6cf3062a5935c90d37183a5c9715c08f42a',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	openOraclePriceCoordinatorFactory: '0xd3ffdcf93d85b56e5bc3432f2ac50ed6c7515f23f3068a9451774773c6f1dd4b',
	priceCoordinatorDeploymentWorker: '0x098071f12c722141ed4ae18b7cfdc94c0b912ac4706cce8c129873809c8abe99',
	securityPoolEventEmitter: '0xd6334e44947bed787f35654d650504061ec1f632f1bf6f7e7370b0e108609e73',
	securityPoolFactory: '0xed93608db8a46636dbea6374b016ef2b6643c1b3d28059a5e2b068b6261e3610',
	securityPoolForker: '0x2d1f528aaaef475117061be7acc10e2bb9e1e6524c47abed973d2beb115e3f0a',
	securityPoolOperationsDelegate: '0xf36906d0baf47720831d3de59569a335c42978ab78ed3c3c5d534b76f2da157a',
	shareTokenFactory: '0xc5990d66cb44508fae0e32847d4e2281caec62ca54e073ba160f2a4f03589593',
	sharedPoolPriceFeedDeploymentWorker: '0x9024e7af6ad294e02cb39e216f8df525280995bd42d02ed52a5a8fc666594278',
}

const EXPECTED_NO_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_MAINNET_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0x60381354335fda3fb785555035059672ad4ea3cba030fe14a501aaf98677b971',
	securityPoolForker: '0x11e7c893af7dea8da798ea9d2de1a23fd200edd277164cef3106faddf1de19cb',
	shareTokenFactory: '0x669c4fba6ff67c823e64d3de80c6661fac64222e50213a5aaef947a592b0ae44',
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
			id: 'securityPoolOperationsDelegate',
			label: 'SecurityPoolOperationsDelegate',
			address: addresses.securityPoolOperationsDelegate,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolOperationsDelegateByteCode()),
		},
		{
			id: 'securityPoolEventEmitter',
			label: 'SecurityPoolEventEmitter',
			address: addresses.securityPoolEventEmitter,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolEventEmitterByteCode()),
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
			id: 'priceCoordinatorDeploymentWorker',
			label: 'PriceCoordinatorDeploymentWorker',
			address: addresses.priceCoordinatorDeploymentWorker,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getPriceCoordinatorDeploymentWorkerByteCode()),
		},
		{
			id: 'sharedPoolPriceFeedDeploymentWorker',
			label: 'SharedPoolPriceFeedDeploymentWorker',
			address: addresses.sharedPoolPriceFeedDeploymentWorker,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getSharedPoolPriceFeedDeploymentWorkerByteCode()),
		},
		{
			id: 'openOraclePriceCoordinatorFactory',
			label: 'OpenOraclePriceCoordinatorFactory',
			address: addresses.openOraclePriceCoordinatorFactory,
			dependencies: ['proxyDeployer', 'priceCoordinatorDeploymentWorker', 'sharedPoolPriceFeedDeploymentWorker'],
			deploy: async client => await deployViaProxy(client, getOpenOraclePriceCoordinatorFactoryByteCode(profile.wethAddress)),
		},
		{
			id: 'securityPoolForkerPortfolioDelegate',
			label: 'SecurityPoolForkerPortfolioDelegate',
			address: addresses.securityPoolForkerPortfolioDelegate,
			dependencies: ['proxyDeployer', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolForkerPortfolioDelegateByteCode(addresses.zoltar)),
			expectedRuntimeCodeHash: keccak256(runtimeWithAddresses(nativePortfolioForkArtifact, [addresses.zoltar])),
		},
		{
			id: 'securityPoolForker',
			label: 'SecurityPoolForker',
			address: addresses.securityPoolForker,
			dependencies: ['proxyDeployer', 'zoltar', 'securityPoolForkerPortfolioDelegate'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolForkerByteCode(addresses.zoltar)),
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
			dependencies: ['proxyDeployer', 'securityPoolForker', 'securityPoolOperationsDelegate', 'securityPoolEventEmitter', 'zoltarQuestionData', 'escalationGameFactory', 'openOracle', 'zoltar', 'shareTokenFactory', 'openOraclePriceCoordinatorFactory'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolFactoryByteCode(addresses)),
		},
		...portfolioModuleDeployments.map(
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
		addresses.securityPoolOperationsDelegate,
		addresses.securityPoolEventEmitter,
		addresses.openOracle,
		addresses.shareTokenFactory,
		addresses.priceCoordinatorDeploymentWorker,
		addresses.sharedPoolPriceFeedDeploymentWorker,
		addresses.openOraclePriceCoordinatorFactory,
		addresses.securityPoolForkerPortfolioDelegate,
		addresses.securityPoolForker,
		addresses.escalationGameDepositDelegate,
		addresses.escalationGameFactory,
		addresses.securityPoolFactory,
		...portfolioModuleDeployments.map(module => addresses[module.id]),
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
