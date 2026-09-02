import { encodeDeployData, getAddress, getCreate2Address, toHex } from '@zoltar/bot-shared/ethereum'
import { chaos_GenesisUniswapV3Seeder_GenesisUniswapV3Seeder } from '../../../../solidity/ts/types/contractArtifact.ts'

export const CANONICAL_PROXY_DEPLOYER = getAddress('0x7a0d94f55792c434d74a40883c6ed8545e406d12')
export const CANONICAL_PROXY_DEPLOYER_RUNTIME = '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3'
export const CANONICAL_UNISWAP_V3_FACTORY = getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984')
export const GENESIS_UNISWAP_FEE = 10_000
export const GENESIS_UNISWAP_SQRT_PRICE_X96 = 1n << 96n
export const GENESIS_UNISWAP_TICK_LOWER = -887_200
export const GENESIS_UNISWAP_TICK_UPPER = 887_200

export function genesisUniswapSeederDeployment() {
	const data = encodeDeployData({
		abi: chaos_GenesisUniswapV3Seeder_GenesisUniswapV3Seeder.abi,
		bytecode: `0x${chaos_GenesisUniswapV3Seeder_GenesisUniswapV3Seeder.evm.bytecode.object}`,
	})
	return {
		address: getCreate2Address({ bytecode: data, from: CANONICAL_PROXY_DEPLOYER, salt: toHex(0, { size: 32 }) }),
		data,
		runtime: `0x${chaos_GenesisUniswapV3Seeder_GenesisUniswapV3Seeder.evm.deployedBytecode.object}`,
	}
}
