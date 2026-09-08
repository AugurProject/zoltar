import { getAddress, getCreate2Address, keccak256, numberToBytes, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'

type RepTokenAddressConfig = {
	genesisRepTokenAddress: Address
	getReputationTokenInitCode: (zoltarAddress: Address) => Hex
	getZoltarAddress: () => Address
}

function deriveRepTokenAddress(universeId: bigint, genesisRepTokenAddress: Address, zoltarAddress: Address, reputationTokenInitCode: Hex): Address {
	if (universeId === 0n) return getAddress(genesisRepTokenAddress)

	return getCreate2Address({
		from: zoltarAddress,
		salt: numberToBytes(universeId, { size: 32 }),
		bytecodeHash: keccak256(reputationTokenInitCode),
	})
}

export function createRepTokenAddressHelper(config: RepTokenAddressConfig) {
	const getRepTokenAddress = (universeId: bigint) => {
		const zoltarAddress = config.getZoltarAddress()
		return deriveRepTokenAddress(universeId, config.genesisRepTokenAddress, zoltarAddress, config.getReputationTokenInitCode(zoltarAddress))
	}

	return {
		getRepTokenAddress,
	}
}
