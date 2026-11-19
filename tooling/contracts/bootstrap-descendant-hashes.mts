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
	escalationGameCreationCodePartOne: '0xd847135f3357399a58107578526b996fb9595ecb7ee63220a09349c997dcdb05',
	escalationGameCreationCodePartTwo: '0xdeb7e8ca8cb12dc82dd6b4183473754ad19d6c2486262e890995dbd7a696d613',
	escalationGameProofVerifier: '0x952e7fb065531350d379c8e2af2f3d0d3322609a5ef82b9acb61d1030f65237c',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0x48b3836f1b6bb205870feaf5667fed685457b2eee79b3eadc71a12270930970e',
	securityPoolAuctionCreationCodeSecondChunk: '0x3601780d2b0dade60cdf52f2fae693e20e5d6b3bac6a73e01b3f5ec22e8295ea',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x04f0a738e69c8e2e00edfc79cf6a8b785ec46d345093bb1fb68b7c4c574c145d',
	securityPoolCapitalCreationCodeSecondChunk: '0x3a2cb3caabdffd3af0a57559bb73537c7f665365791aada4cd9d9a8221e94705',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0xaf865aa7d492d33f8de535cc6c268e1dc86be493cc2e25d775d38f6de1207b77',
	securityPoolForkCreationCodeSecondChunk: '0x7425a3210edd9605670935a0f11df2c5827edd49b5a82aeba7f3164759fb501c',
	securityPoolServicesCreationCodeFirstChunk: '0xfc95e05adc7e6d6e5d922cf2460773ab350e651c16443416d1c8b17d0330e5b6',
	securityPoolServicesCreationCodeSecondChunk: '0xc0da9cfd3ace1cbdc181cc642f00d4aceea3e7edefe636caaef17871664cb23b',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x069ec7f03aa297128c743d995cd8c0a981491b184a7c875f3c13205df769d38d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x61c7b2e841bc32a35acb904533a64958813ec08c12d80796db73553114af3633',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xfc7537a2e1299aa377bb43766a9249f6229ffb3bcb101aba7f5301496af046bc',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xb45f90383f7317bced705d34c2a304522aa5cbc07ad9c7edb214da5e124ea26b',
	securityPoolCapitalFeeStreamsImplementation: '0x9cf080d4bf9b5c9b4ca7503ac5b481a79783007392e7c399087486d385dbc487',
	securityPoolCommitmentIndexImplementation: '0x7e76667a83cd6a522c854eeadd99d4f905a547aa0b30cd5a7494b25bc14da4e6',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x261e8526b4e989312b6416f5b46b787d16746aac5cf51c33ae27572b0f102a5b',
		securityPoolDeploymentWorker: '0x4e7812f3e04f06b669a5a858ae30cbf1b9e77decd2b6a9815604a73b63302354',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x13cf732c571676625ca0aa04617f2f5b30d2864ac855b9dc2d9aef773e5ec913',
		securityPoolDeploymentWorker: '0xda9a983c753d9dcaa1f91f4d53509ef9708ef98b3aa81489b36e1f3e6ea7531e',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x062c4f96971e7b3f51d8760e424793f5d344b8f29ce6223977e07d3999b1b47b',
		securityPoolDeploymentWorker: '0xa1e3c68a85e087c2b20760f27460de7b4ef1bbfcfd9ee76d62e52a9914f5ac3e',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xd4fd85ed9071622cc2be562366314926132d26ac9d00c2d1f15e0890ca9d7c1f',
		securityPoolDeploymentWorker: '0x4c7a6500521bd68207d3476b2307e841b4c327f1b5cdd80a1cb51a3b167e7684',
	},
	deterministic: {
		securityPoolDeployer: '0x515b518f7a1699ca6bdfd79a6c87986a71c34791b9d49d0a116fa7881ea5ac50',
		securityPoolDeploymentWorker: '0x2afeb1b3c7f9184550a793ceb3d7a3d9b4ebe7bb2a82fb22d7abd61b3b8e9b6b',
	},
	mainnet: {
		securityPoolDeployer: '0xa6bdb527206642b18ffe9af5686ab1034b28cb561df2b61941b7ba7ef6210277',
		securityPoolDeploymentWorker: '0xdf33f43c69bdbfde777e20bd20336f1b86a10f1109d64e235545be298572ad6c',
	},
}
