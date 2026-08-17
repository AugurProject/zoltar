import { SEPOLIA_REP_ALLOCATIONS } from '@zoltar/shared/sepoliaRepAllocations'
import { encodeDeployData, getCreate2Address, toHex, type Hex } from '@zoltar/shared/ethereum'
import { GenesisReputationToken_GenesisReputationToken, peripherals_WETH9_WETH9 } from '../contractArtifact.js'

const PROXY_DEPLOYER_ADDRESS = '0x7A0D94F55792C434D74A40883c6ED8545e406D12'
const ZERO_SALT = toHex(0, { size: 32 })

export const SEPOLIA_GENESIS_REP_INIT_CODE = encodeDeployData({
	abi: GenesisReputationToken_GenesisReputationToken.abi,
	bytecode: `0x${GenesisReputationToken_GenesisReputationToken.evm.bytecode.object}`,
	args: [SEPOLIA_REP_ALLOCATIONS.map(allocation => allocation.address), SEPOLIA_REP_ALLOCATIONS.map(allocation => allocation.amount)],
})

export const SEPOLIA_WETH_INIT_CODE = `0x${peripherals_WETH9_WETH9.evm.bytecode.object}` satisfies Hex

export const SEPOLIA_GENESIS_REP_ADDRESS = getCreate2Address({
	bytecode: SEPOLIA_GENESIS_REP_INIT_CODE,
	from: PROXY_DEPLOYER_ADDRESS,
	salt: ZERO_SALT,
})

export const SEPOLIA_WETH_ADDRESS = getCreate2Address({
	bytecode: SEPOLIA_WETH_INIT_CODE,
	from: PROXY_DEPLOYER_ADDRESS,
	salt: ZERO_SALT,
})
