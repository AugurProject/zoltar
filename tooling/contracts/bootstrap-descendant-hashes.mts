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
		securityPoolDeployer: '0xa165c59e13cb6fdea0004176153b492b06dfdc1e0421c7dd3f788130a81ea3cf',
		securityPoolDeploymentWorker: '0x5f4115fe724df0ec7b39e75be5e5ca3f185ac371fb8ab41725a6e239ecc6de9c',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xfd6775931e7410c47745afcdbfa46608ab0723eea0cf4eb48f0d6d331610f4a3',
		securityPoolDeploymentWorker: '0x98c698bc2e7facf944923f788d001f02fbcb9b5542d7648e4795f0c76fae37d4',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xafb293227f0062097add14e69e30dc253bd0715e5432053b910f7c5aae70e925',
		securityPoolDeploymentWorker: '0xa993b615600e99db2ef508fa37013503063c96e07d5094cabd5eb035603303bb',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x0bea89c3f7f92953eb91e3733dc9e0998bde6af5ba0c2e43c669fc7b4e944f8a',
		securityPoolDeploymentWorker: '0x7ce7603680e9145c24f373c9b0164e124af859c7042b4a0d5797aea3d0e41a5a',
	},
	deterministic: {
		securityPoolDeployer: '0xf832ec9f62226e5c4caffe17783236c6346f31de44c164547d5b8b57287531ec',
		securityPoolDeploymentWorker: '0x33901ca3c43b9b3ef18ad8aed79d755ff77fde471ca518af1df40012a000b6d2',
	},
	mainnet: {
		securityPoolDeployer: '0x77b18db1e091139657e29a634f1d810ffef743b38338fe6c345b55a5dad6a839',
		securityPoolDeploymentWorker: '0x4d4d59f38dd57abcf0c994c063811523a79f7529f55c83c963368011a2f04404',
	},
}
