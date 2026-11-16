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
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0xa4d131b6fd2dc31538ca28ee1f9fe758442b771fa8696331e5c76e5f2dd95748',
	securityPoolAuctionCreationCodeSecondChunk: '0xbb3d5959b2440cf48be49bdbb280db2538e364ddfc6fca38aa4125abc17c555c',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x6c341c710e50657b8800e482a61b9d2a471fbb54c988cd1db3360521dd1c7f65',
	securityPoolCapitalCreationCodeSecondChunk: '0x55697369084e2f8d6cddbc050ec243e28faaf2371abf3023563ca505ed7c2968',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
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
		securityPoolDeployer: '0xe33e1dcc542779655386efbffacb34577f054d8f7915e7b1cc7b2ca332d6b11e',
		securityPoolDeploymentWorker: '0x22387a8e3d9b5cb6e0a48e1eb866585548a0da3d4c930d82aaa3c26b37089016',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x8cb2da4face2ee96bec385d5a698df7aab3d9fbafde4fdac78391501a91cd1bb',
		securityPoolDeploymentWorker: '0x3b452c63d63f97de6b2620cb81c6e7e8ac12ad58cd3006af9822974a09722f55',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x2c1428d3750ecec5ff0345c462d29f946cb9117ccded18374ba0452d50e29a96',
		securityPoolDeploymentWorker: '0xc8e2d9056bb8e7ffc62dc865957560ce8d9dedd81b8c799763e3efc37965e954',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xb8bd74557a971ec50fe7b8f2f70827ede578842649e3bf242d9a7dec2e036ede',
		securityPoolDeploymentWorker: '0xf158adeb3ec368a0e4c71f61e8455a10e29451c2b91c6d6913668c3f38f55f94',
	},
	deterministic: {
		securityPoolDeployer: '0xb5a38a42fc411683120e9e5fef7aa3068e7503329d5a770a105e223239976d2e',
		securityPoolDeploymentWorker: '0xfe4475088e7e4d5c567cf85baf641161d7f4c628947643c06c071ce8e30912c4',
	},
	mainnet: {
		securityPoolDeployer: '0x1dee74fe9301a7b6823a496a0d7994d70e09afb463f72fb2216fe98c2c001609',
		securityPoolDeploymentWorker: '0xa2a0b08234146a1f9f87f2a7150fcd42e976ed85de86b8d7fcbddc9dc6fecfc2',
	},
}
