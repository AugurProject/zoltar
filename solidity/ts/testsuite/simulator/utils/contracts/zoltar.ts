import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '../../../../types/contractArtifact'
import { createAddressDerivationHelpers } from '../../../../../../shared/js/addressDerivation.js'
import { createDeploymentAddressHelpers } from '../../../../../../shared/js/deploymentAddresses.js'
import { ReadClient, WriteClient, writeContractAndWait } from '../viem'
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS } from '../constants'
import { encodeDeployData, getAddress, toHex } from 'viem'
import { addressString } from '../bigint'
import { ensureProxyDeployerDeployed } from '../utilities'

const ZERO_SALT = toHex(0, { size: 32 })

function getZoltarInitCode(zoltarQuestionDataAddress: `0x${string}`): `0x${string}` {
	return encodeDeployData({
		abi: Zoltar_Zoltar.abi,
		bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
		args: [zoltarQuestionDataAddress],
	})
}

const deploymentAddressHelpers = createDeploymentAddressHelpers({
	deploymentStatusOracleBytecode: () => {
		throw new Error('deploymentStatusOracleBytecode is not available in zoltar helper')
	},
	getEscalationGameFactoryByteCode: () => {
		throw new Error('getEscalationGameFactoryByteCode is not available in zoltar helper')
	},
	getSecurityPoolFactoryByteCode: () => {
		throw new Error('getSecurityPoolFactoryByteCode is not available in zoltar helper')
	},
	getSecurityPoolForkerByteCode: () => {
		throw new Error('getSecurityPoolForkerByteCode is not available in zoltar helper')
	},
	getShareTokenFactoryByteCode: () => {
		throw new Error('getShareTokenFactoryByteCode is not available in zoltar helper')
	},
	getZoltarInitCode,
	libraryReplacements: () => [],
	openOracleBytecode: '0x',
	priceOracleManagerAndOperatorQueuerFactoryBytecode: '0x',
	proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS),
	scalarOutcomesBytecode: '0x',
	securityPoolUtilsBytecode: '0x',
	uniformPriceDualCapBatchAuctionFactoryBytecode: '0x',
	zeroSalt: ZERO_SALT,
	zoltarQuestionDataBytecode: () => `0x${ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object}`,
})

export const { getZoltarAddress } = deploymentAddressHelpers
const { getZoltarQuestionDataAddress } = deploymentAddressHelpers

export const { getRepTokenAddress } = createAddressDerivationHelpers({
	genesisRepTokenAddress: getAddress(addressString(GENESIS_REPUTATION_TOKEN)),
	getEscalationGameInitCode: () => {
		throw new Error('getEscalationGameInitCode is not available in zoltar helper')
	},
	getInfraContracts: () => {
		throw new Error('getInfraContracts is not available in zoltar helper')
	},
	getPriceOracleManagerAndOperatorQueuerInitCode: () => {
		throw new Error('getPriceOracleManagerAndOperatorQueuerInitCode is not available in zoltar helper')
	},
	getReputationTokenInitCode: zoltarAddress =>
		encodeDeployData({
			abi: ReputationToken_ReputationToken.abi,
			bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
			args: [zoltarAddress],
		}),
	getSecurityPoolInitCode: () => {
		throw new Error('getSecurityPoolInitCode is not available in zoltar helper')
	},
	getShareTokenInitCode: () => {
		throw new Error('getShareTokenInitCode is not available in zoltar helper')
	},
	getTruthAuctionInitCode: () => {
		throw new Error('getTruthAuctionInitCode is not available in zoltar helper')
	},
	getZoltarAddress: () => getZoltarAddress(),
})

const isZoltarQuestionDataDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${string}` = `0x${ZoltarQuestionData_ZoltarQuestionData.evm.deployedBytecode.object}`
	const address = getZoltarQuestionDataAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

const deployZoltarQuestionDataTransaction = (): { data: `0x${string}`; to: `0x${string}` } => ({
	data: `0x${ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object}`,
	to: addressString(PROXY_DEPLOYER_ADDRESS),
})

const ensureZoltarQuestionDataDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	if (await isZoltarQuestionDataDeployed(client)) return
	const hash = await client.sendTransaction(deployZoltarQuestionDataTransaction())
	await client.waitForTransactionReceipt({ hash })
}

export const isZoltarDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${string}` = `0x${Zoltar_Zoltar.evm.deployedBytecode.object}`
	const address = getZoltarAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

export const ensureZoltarDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	// Ensure ZoltarQuestionData is deployed first
	await ensureZoltarQuestionDataDeployed(client)
	if (await isZoltarDeployed(client)) return
	const zoltarQuestionDataAddress = getZoltarQuestionDataAddress()
	const initCode = getZoltarInitCode(zoltarQuestionDataAddress)
	const hash = await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: initCode })
	await client.waitForTransactionReceipt({ hash })
}

export const getUniverseData = async (client: ReadClient, universeId: bigint) => {
	const [forkTime, forkQuestionId, forkingOutcomeIndex, reputationToken, parentUniverseId] = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'universes',
		address: getZoltarAddress(),
		args: [universeId],
	})
	return { forkTime, forkQuestionId, forkingOutcomeIndex, reputationToken, parentUniverseId }
}

export const forkUniverse = async (client: WriteClient, universeId: bigint, questionId: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'forkUniverse',
			address: getZoltarAddress(),
			args: [universeId, questionId],
		}),
	)

export const addRepToMigrationBalance = async (client: WriteClient, universeId: bigint, amount: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'addRepToMigrationBalance',
			address: getZoltarAddress(),
			args: [universeId, amount],
		}),
	)

export const splitMigrationRep = async (client: WriteClient, universeId: bigint, amount: bigint, outcomeIndexes: (number | bigint)[]) => {
	const bigintIndices = outcomeIndexes.map(x => BigInt(x))
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'splitMigrationRep',
			address: getZoltarAddress(),
			args: [universeId, amount, bigintIndices],
		}),
	)
}

export async function getTotalTheoreticalSupply(client: ReadClient, repToken: `0x${string}`) {
	return await client.readContract({
		abi: ReputationToken_ReputationToken.abi,
		functionName: 'getTotalTheoreticalSupply',
		address: repToken,
		args: [],
	})
}

export const getZoltarForkThreshold = async (client: ReadClient, universeId: bigint) =>
	await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getForkThreshold',
		address: getZoltarAddress(),
		args: [universeId],
	})

export const deployChild = async (client: WriteClient, universeId: bigint, outcomeIndex: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'deployChild',
			address: getZoltarAddress(),
			args: [universeId, outcomeIndex],
		}),
	)

export const getMigrationRepBalance = async (client: ReadClient, universeId: bigint, address: `0x${string}`) => {
	const repBalance = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getMigrationRepBalance',
		address: getZoltarAddress(),
		args: [address, universeId],
	})
	return repBalance
}
