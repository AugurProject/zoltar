import type { Hash } from '@zoltar/core-shared/evm/ethereum'

/**
 * Runtime code hashes of the contracts that protocol factories create on first use.
 * `sepolia` covers Sepolia and any chain with Uniswap's published Sepolia WETH;
 * `deterministic` covers testnets whose WETH is the deterministic WETH9 deployment.
 * tooling/contracts/deployment-runtime-hashes.test.ts verifies every table on Anvil.
 */
export type BootstrapDescendantHashProfile = 'deterministic' | 'mainnet' | 'sepolia'

// Every descendant except the security pool deployer and its deployment worker hashes identically on all profiles.
const PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	escalationGameCreationCodePartOne: '0x47b7df45744196388360a847f5bae40b39c25ceeea5af62f009ffb59b5c86cd3',
	escalationGameCreationCodePartTwo: '0x4353b6da3ced3961cfdfb922ca5498413b337e55bfa8341d5e31d4b38d8f0697',
	escalationGameProofVerifier: '0xae36c0b208871ec2ab53bbcac4fd1ca7d2c39e1a406889adcd12545127b0d2a3',
	oracleReportDelegate: '0xfe9632a17fb2292d3e7b5cc7b1060e0a4b06a12c5ba3a9e13fba15335d3f4092',
	priceCoordinatorCreationCodeFirstChunk: '0xd3be043ebe146053bcecfb6c0d4a14d3bf7f958508e3307980c648f56a45df95',
	priceCoordinatorCreationCodeSecondChunk: '0x70b4c429a27b733e17e494f36dc073daeb1c46927f5a4f94e694409f535007c7',
	securityPoolAuctionCreationCodeFirstChunk: '0xa4d131b6fd2dc31538ca28ee1f9fe758442b771fa8696331e5c76e5f2dd95748',
	securityPoolAuctionCreationCodeSecondChunk: '0xbb3d5959b2440cf48be49bdbb280db2538e364ddfc6fca38aa4125abc17c555c',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x4cd6636d44914f008e55434a789dba346c13a6146e25b3b94d9fbe93483ff8de',
	securityPoolCapitalCreationCodeSecondChunk: '0x69e781aa005f8742d8a3cdfb26c4b902eed7032dd24efeebd6a90b1444fae0b3',
	securityPoolCreationCodeFirstChunk: '0x01f1d4d61ef7c12d5a795b4fdb851dd337c30d5f937fd7e0c17a46eee3d50042',
	securityPoolCreationCodeSecondChunk: '0x521cf4be74b3f7e40f5f8d6f7e6669b6c73aaccba1bdeebab2779b2f552939a9',
	securityPoolForkCreationCodeFirstChunk: '0x24e14e35307cf8a58e781bb11bc122da9f030411710396e8aaac1925f1606c2d',
	securityPoolForkCreationCodeSecondChunk: '0x0596df0ea535727c1994cd09d5d50afc690f175a06ad7a0178edc0e749613ce7',
	securityPoolServicesCreationCodeFirstChunk: '0x55a33d73b9f42e4d6f703c077213edf4abad4c6ebe1416933b213cdb28539851',
	securityPoolServicesCreationCodeSecondChunk: '0x800f8c538ff1d99ffa134d806226a8a902f74f890edf08b411c0c0307b89309c',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x4b7f917f29579365b68d9694e306170f26471f15f190726952bd9ce9dd21a967',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xfb43ef5f9b1dbcf433c8ca859fa67f4150f4499fa6dc8229e788dacc4466fc76',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x0a199aced6bfc36ffe26981aa68e3f1d77a7ec91b1bcda4d4b3685a6198ba2c0',
		securityPoolDeploymentWorker: '0x5fcffa045f3add2bac8ff8ff7c0cea820af499d9fd7669e3a8bebf9a6a6272cf',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x60e241d7ad910adb8179aa1e82264f3369807bc0de3250c2eb690c76c9f6b54e',
		securityPoolDeploymentWorker: '0x5508ad1b116104e84d7a82a30f8ccfa86dc715ac3653f51d3465cd703c376149',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x7076fedebc900f29b583f51c8ff97b12f70bb7c04c7e1712c33d7e86c210e5d6',
		securityPoolDeploymentWorker: '0x25a73de0abca924adb17a8fea6dea479ed014bcbf0078b4fbd9af07b8f87799f',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xeac89c22f5326d2e62d7e1146f2ca645b0439d55bd45efe0cecfe08da79706b1',
		securityPoolDeploymentWorker: '0xf6f03ae0b3e9e3a8b567f1bd42885e5a55f3872261c710130821d478077e5a57',
	},
	deterministic: {
		securityPoolDeployer: '0x20638230ca3d1f199a7bbdeb803e39e5a0b2a8344cc5523d2b05b9f4e316eb5f',
		securityPoolDeploymentWorker: '0x86d2dde814f3b5a1f3ae0f323b53a7b6a9af1b2f8bc698bcb4f3203e6c6960c3',
	},
	mainnet: {
		securityPoolDeployer: '0x7301cb9d5056c177f0f9a074826f0d170c118c003f851c188835e6503be29600',
		securityPoolDeploymentWorker: '0x1710fd43567e74d470bfbee335833341196e7595ce70d523219181dd1ed7208f',
	},
}
