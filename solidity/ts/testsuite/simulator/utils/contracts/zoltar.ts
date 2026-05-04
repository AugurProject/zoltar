import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '../../../../types/contractArtifact'
import { createRepTokenAddressHelper } from '../../../../../../shared/js/addressDerivation.js'
import { createZoltarAddressHelpers } from '../../../../../../shared/js/deploymentAddresses.js'
import { ReadClient, WriteClient, writeContractAndWait } from '../viem'
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS } from '../constants'
import { encodeDeployData, getAddress, type Address, type Hex, toHex } from 'viem'
import { addressString } from '../bigint'
import { ensureProxyDeployerDeployed } from '../utilities'

const ZERO_SALT: Hex = toHex(0, { size: 32 })

function getZoltarInitCode(zoltarQuestionDataAddress: Address, genesisRepTokenAddress: Address): Hex {
	return encodeDeployData({
		abi: Zoltar_Zoltar.abi,
		bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
		args: [zoltarQuestionDataAddress, genesisRepTokenAddress],
	})
}

export const { getZoltarAddress } = createZoltarAddressHelpers({
	genesisRepTokenAddress: getAddress(addressString(GENESIS_REPUTATION_TOKEN)),
	getZoltarInitCode,
	proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS),
	zeroSalt: ZERO_SALT,
	zoltarQuestionDataBytecode: () => `0x${ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object}`,
})

const { getZoltarQuestionDataAddress } = createZoltarAddressHelpers({
	genesisRepTokenAddress: getAddress(addressString(GENESIS_REPUTATION_TOKEN)),
	getZoltarInitCode,
	proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS),
	zeroSalt: ZERO_SALT,
	zoltarQuestionDataBytecode: () => `0x${ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object}`,
})

export const { getRepTokenAddress } = createRepTokenAddressHelper({
	genesisRepTokenAddress: getAddress(addressString(GENESIS_REPUTATION_TOKEN)),
	getReputationTokenInitCode: zoltarAddress =>
		encodeDeployData({
			abi: ReputationToken_ReputationToken.abi,
			bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
			args: [zoltarAddress],
		}),
	getZoltarAddress,
})

const isZoltarQuestionDataDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: Hex = `0x${ZoltarQuestionData_ZoltarQuestionData.evm.deployedBytecode.object}`
	const address = getZoltarQuestionDataAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

const deployZoltarQuestionDataTransaction = (): { data: Hex; to: Address } => ({
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
	const address = getZoltarAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode !== undefined && deployedBytecode !== '0x'
}

export const ensureZoltarDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	// Ensure ZoltarQuestionData is deployed first
	await ensureZoltarQuestionDataDeployed(client)
	if (await isZoltarDeployed(client)) return
	const zoltarQuestionDataAddress = getZoltarQuestionDataAddress()
	const initCode = getZoltarInitCode(zoltarQuestionDataAddress, getAddress(addressString(GENESIS_REPUTATION_TOKEN)))
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

export async function getTotalTheoreticalSupply(client: ReadClient, repToken: Address) {
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

export const getMigrationRepBalance = async (client: ReadClient, universeId: bigint, address: Address) => {
	const repBalance = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getMigrationRepBalance',
		address: getZoltarAddress(),
		args: [address, universeId],
	})
	return repBalance
}
