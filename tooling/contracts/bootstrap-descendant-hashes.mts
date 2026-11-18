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
	securityPoolCapitalCreationCodeFirstChunk: '0x240e90e678c96559c54234af3266b8b7d9b29a9bbd11b1078e16b0a3198f6473',
	securityPoolCapitalCreationCodeSecondChunk: '0x23c19e92299c3306c97499a3fe37e79d52431c1999fd0b166a0d0f4fd1271fe5',
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
		securityPoolDeployer: '0x221ecbd009b3d9deb85f16d082ac110892cd046c25599c07ec3e0bf2c1892dc9',
		securityPoolDeploymentWorker: '0xadfbc1e2b41317f18b7bd4c56ee11c19cf784c489f60fee01566e69163bb7a37',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x102ac536e386e4bf70a68917c345dcda83faf266fb4cac0a423528244a7aa523',
		securityPoolDeploymentWorker: '0x04f217bc70cab8bc110f46ba281dd7985a61dc0d877a0040e9d1d23cc4579e60',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x83f04b7ad2c9891bae5d1e002f44961b2103e163675dc9f57722b11c7a5047f6',
		securityPoolDeploymentWorker: '0xe37ab42994e2ca7f94e1473d9856972e811b52b89e4a033ae37a40583e501174',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x757b81967dd39a2d35605ac7b5fa584336f59ebe76fb6f7665f30d501f05b074',
		securityPoolDeploymentWorker: '0xf88690196bb6ec8c7d70f37cfcee0693b6522fb3826c6478ff705db1b23bef66',
	},
	deterministic: {
		securityPoolDeployer: '0xe6e5151d3d572cad2a552ac1a3dd5ff7c15a281932834267c0dd1a8374c67e83',
		securityPoolDeploymentWorker: '0xfc2be7a82f2c31fe5dbc80ac99f3b0417b96b5b865fc7bf78e86f3e80e527406',
	},
	mainnet: {
		securityPoolDeployer: '0xdcfb71659a75bcde1b1bf1566544cb1e074161b231f35fefdbd2ada4a9c0f8f9',
		securityPoolDeploymentWorker: '0x282b3543aac5399d51676f16a64d958cffe5b0dfa9bf39e8578a84b2ec9ede35',
	},
}
