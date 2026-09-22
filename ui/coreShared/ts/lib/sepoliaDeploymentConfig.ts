import { SEPOLIA_REP_ALLOCATIONS } from '@zoltar/zoltar-shared/deployment/sepoliaRepAllocations'
import { encodeDeployData, getAddress, getCreate2Address, toHex } from '@zoltar/core-shared/evm/ethereum'
import { GenesisReputationToken_GenesisReputationToken } from '../contractArtifact.js'

const PROXY_DEPLOYER_ADDRESS = '0x7A0D94F55792C434D74A40883c6ED8545e406D12'
const ZERO_SALT = toHex(0, { size: 32 })

export const SEPOLIA_GENESIS_REP_INIT_CODE = encodeDeployData({
	abi: GenesisReputationToken_GenesisReputationToken.abi,
	bytecode: `0x${GenesisReputationToken_GenesisReputationToken.evm.bytecode.object}`,
	args: [SEPOLIA_REP_ALLOCATIONS.map(allocation => allocation.address), SEPOLIA_REP_ALLOCATIONS.map(allocation => allocation.amount)],
})

export const SEPOLIA_GENESIS_REP_ADDRESS = getCreate2Address({
	bytecode: SEPOLIA_GENESIS_REP_INIT_CODE,
	from: PROXY_DEPLOYER_ADDRESS,
	salt: ZERO_SALT,
})

// Uniswap's published Sepolia WETH:
// https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments
export const SEPOLIA_WETH_ADDRESS = getAddress('0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14')
