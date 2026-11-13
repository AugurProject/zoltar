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
		securityPoolDeployer: '0xbc40929eca8a2924c416d37ac5eea8d724e66744294ba73cb5809faa8b768472',
		securityPoolDeploymentWorker: '0xb9d9cbcaffa4dfedce95f0a583f64405a7d8d8214629ad22726a2b1b87221bbd',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xe5983316f1884404a05470180a9b16c5981c0f62ca30d56b2ac9721676db33fe',
		securityPoolDeploymentWorker: '0x45318f876d9c5cf45b7052be871d58cc2a28bc7cc9513e50a77cef1677b52569',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x32d870a820671fd56648715af023ffdc8528959ada6d04a4d860fa169375d222',
		securityPoolDeploymentWorker: '0x4f57efb372ebfd41723c0de2f39e4da4404ffc1498bac65e0847718d97581534',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xab7b376ffc8ffe84e7e2ea7795afdadbf4f3488ff6f8071075ead0f5f05ec405',
		securityPoolDeploymentWorker: '0x397c5303213992e433e8a0178fb2c71fe0d1e89114be06388e41c089dce9953d',
	},
	deterministic: {
		securityPoolDeployer: '0x884568d35c41d3ae9ec4cd7cbd408a6ab309080eb79946632080c843a96ded4c',
		securityPoolDeploymentWorker: '0xd13a2212e0ed9d605dd6d85891a19691c23fc873afae255abfb353fe87bc074b',
	},
	mainnet: {
		securityPoolDeployer: '0xd7ba759477387e582bc55435105e9aca7639765e351be916a09d0e84373ae52a',
		securityPoolDeploymentWorker: '0xe64b296fffe147d573e856d54ef9d89a3c0aec8eab0c33fda9b0fe12a4e0150d',
	},
}
