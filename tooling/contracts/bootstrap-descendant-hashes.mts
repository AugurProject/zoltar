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
	securityPoolCapitalCreationCodeFirstChunk: '0xf938ac90e0712d773af0e06ff008f6731730b45d7be26734f9151f22536ccfa2',
	securityPoolCapitalCreationCodeSecondChunk: '0xcc19f51dd9859f4ca4c303edc80f0f2ece51871a681c889cc72f19caa65f3534',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0xaf865aa7d492d33f8de535cc6c268e1dc86be493cc2e25d775d38f6de1207b77',
	securityPoolForkCreationCodeSecondChunk: '0x7425a3210edd9605670935a0f11df2c5827edd49b5a82aeba7f3164759fb501c',
	securityPoolServicesCreationCodeFirstChunk: '0xfc95e05adc7e6d6e5d922cf2460773ab350e651c16443416d1c8b17d0330e5b6',
	securityPoolServicesCreationCodeSecondChunk: '0xc0da9cfd3ace1cbdc181cc642f00d4aceea3e7edefe636caaef17871664cb23b',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x069ec7f03aa297128c743d995cd8c0a981491b184a7c875f3c13205df769d38d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x61c7b2e841bc32a35acb904533a64958813ec08c12d80796db73553114af3633',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x6b0463ea550a3e1a983abf29008c1728839811b35cf84e5327812ac81288b804',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x2bb6c94ca89e47c511cd3bd3e99692498805f84d972ae7ecb982b119ddb236ad',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x04660800b24d989288f3a370b87523b95589754869f25b0ecccab812b67399fb',
		securityPoolDeploymentWorker: '0x6bdb9b9cefc871ca5cec336ce6453c57c1b0827b83d45ece10d5c6d0d14a5cc1',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xf11c9a10e9118f193ba1461080479ebcb8757149dd7e9deb45d43e8f449dc8c0',
		securityPoolDeploymentWorker: '0x5a4d2988b72154bc22998025c9fa874ce5c6e2b5d68a2ad25365f93f3ef7c7f4',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x252104771a8b7e39cb814a619a23707a4828ed86a8fdbf4111825b62b84b9876',
		securityPoolDeploymentWorker: '0x3d52f34dc258753d3948b6558df42bc16e73c3c1c0f597e3bdebf9045469a8aa',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x4210cd95791903460e8d2423a856c5eb9110e770c4ae4cdb3a7226edbe8a4b94',
		securityPoolDeploymentWorker: '0x7432b43d6d5fb4645e4692982310104ea82b1717d5bdc6a8fe0cf20ee93a860a',
	},
	deterministic: {
		securityPoolDeployer: '0xed0b30ceef0bdc2e80403ab16ff126ae7a485d5e42e604a201a952c4af524f7f',
		securityPoolDeploymentWorker: '0x7ee6e4df56f6d1f6a1c241f48dd956003fe204108013eaefd7ecc33dd86ac3eb',
	},
	mainnet: {
		securityPoolDeployer: '0x8bf56ea041a088ee205c3acfaa7dbf1b377a82ae4f023c18d5bc12b3b71c4070',
		securityPoolDeploymentWorker: '0xadc8c30aec1b02dfbfff5bd6734a277de18468c0ac2803f05d85814e06f80662',
	},
}
