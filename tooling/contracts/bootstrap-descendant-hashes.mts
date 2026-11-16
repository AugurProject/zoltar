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
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
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
		securityPoolDeployer: '0x7c3c590cb4175d5fcc26fbc5e000b09977b50395e7b09ab6ce4291c8c19a657d',
		securityPoolDeploymentWorker: '0x1c743e3268c3a422257676d5008a241344a1e0bd331a6a748a8d069cf392c0dc',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x543089e37e657bc0155bc11f519f405fe893aeaf33429cdab7d8dd6208be45d7',
		securityPoolDeploymentWorker: '0x60e1f41105d1b02fb54340140939cefce33d9ca0db89ba5a5a45ef457218a486',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xbf58cd15a7c7e84500eddfc5a5936382c40772755e458827f2317a17382620ae',
		securityPoolDeploymentWorker: '0x2b06d9b2f408c00e7e23cc8c2231baa86cdeb838b617f38eb1a97aa216b65632',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xc3d1ca9b557ed515b5f106f43b57e8d470e6e6191f08861cd92fa8d7ed082143',
		securityPoolDeploymentWorker: '0x02e71ccc65d7da38a77b183d6c431c7a8b3e640e5da2d7128da6ba7aea490914',
	},
	deterministic: {
		securityPoolDeployer: '0x4ff5f7100a08f02a68fc7dc50ab5933d58f8d237633d1c42d0a1c801b1866d1e',
		securityPoolDeploymentWorker: '0x9c51a3232551037001f75c7ed3764715c003c350b65b6842edc1d31b8db955aa',
	},
	mainnet: {
		securityPoolDeployer: '0x8070d3671370b4c4d99c4d8fc239a46d8facf0d64456c18fc4cee7f5a11a2e20',
		securityPoolDeploymentWorker: '0x8051a12df8c545a5b49dfbfe651c2c0190d52a1515c3a71afcc1d00e121d5aad',
	},
}
