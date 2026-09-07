import { encodeDeployData, getCreate2Address, keccak256, toHex, type Address, type Hex } from '@zoltar/shared/ethereum'
import { createApplyLinkedLibrariesHelper, createZoltarAddressHelpers } from '@zoltar/shared/deploymentAddresses'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import { ScalarOutcomes_ScalarOutcomes, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData, statoblast_Multicall3_Multicall3 } from '@zoltar/ui-core-shared/contractArtifact.js'
import { getRuntimeNetworkProfile, type NetworkProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { bigintToAddress } from './helpers.js'

export const PROXY_DEPLOYER_ADDRESS = bigintToAddress(0x7a0d94f55792c434d74a40883c6ed8545e406d12n)
export const ZERO_SALT = toHex(0, { size: 32 })
export const MULTICALL3_BYTECODE = `0x${statoblast_Multicall3_Multicall3.evm.bytecode.object}` satisfies Hex

const getScalarOutcomesAddress = () =>
	getCreate2Address({
		bytecode: `0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`,
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
	})

const { applyLibraries } = createApplyLinkedLibrariesHelper(() => [
	{
		address: getScalarOutcomesAddress(),
		hash: keccak256(toHex('contracts/ScalarOutcomes.sol:ScalarOutcomes')).slice(2, 36),
	},
])

export const getZoltarQuestionDataByteCode = () =>
	encodeDeployData({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		bytecode: applyLibraries(ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object),
	})

export const getZoltarInitCode = (zoltarQuestionDataAddress: Address, genesisReputationTokenAddress: Address): Hex =>
	encodeDeployData({
		abi: Zoltar_Zoltar.abi,
		bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
		args: [zoltarQuestionDataAddress, genesisReputationTokenAddress, DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor, DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor],
	})

function getAddressHelpers(profile: NetworkProfile) {
	return createZoltarAddressHelpers({
		getZoltarInitCode: zoltarQuestionDataAddress => getZoltarInitCode(zoltarQuestionDataAddress, profile.genesisRepTokenAddress),
		proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
		zeroSalt: ZERO_SALT,
		zoltarQuestionDataBytecode: getZoltarQuestionDataByteCode,
	})
}

export function getZoltarAddress(profile: NetworkProfile = getRuntimeNetworkProfile()) {
	return getAddressHelpers(profile).getZoltarAddress()
}

export function getZoltarContractAddresses(profile: NetworkProfile = getRuntimeNetworkProfile()) {
	const addressHelpers = getAddressHelpers(profile)
	return {
		multicall3: getCreate2Address({ bytecode: MULTICALL3_BYTECODE, from: PROXY_DEPLOYER_ADDRESS, salt: ZERO_SALT }),
		scalarOutcomes: getScalarOutcomesAddress(),
		zoltar: addressHelpers.getZoltarAddress(),
		zoltarQuestionData: addressHelpers.getZoltarQuestionDataAddress(),
	}
}

export function getMulticall3Address() {
	return getZoltarContractAddresses().multicall3
}
