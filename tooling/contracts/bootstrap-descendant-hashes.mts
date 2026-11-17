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
	escalationGameCreationCodePartOne: '0x40c56464db08b4048d991e2a1d83310015b1f4b07d349e4dfba089442dd034b6',
	escalationGameCreationCodePartTwo: '0xd64e67811c0a1a8b0190afe9970ed4dda09c36615441ace8c33049bb2a60c160',
	escalationGameProofVerifier: '0x952e7fb065531350d379c8e2af2f3d0d3322609a5ef82b9acb61d1030f65237c',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0x48b3836f1b6bb205870feaf5667fed685457b2eee79b3eadc71a12270930970e',
	securityPoolAuctionCreationCodeSecondChunk: '0x3601780d2b0dade60cdf52f2fae693e20e5d6b3bac6a73e01b3f5ec22e8295ea',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x84baf3657948e2c0f7eb14364e1ae9f1b061265868d572fbb6a5d148f232847d',
	securityPoolCapitalCreationCodeSecondChunk: '0xdbff69b9c292b004da62c0142fdb72f8666593f94a8281835005f107b0026852',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0xe1cafd606a7b40e4e249fb26189e2f70ddebd844755f77708c524ae9ea9f22f2',
	securityPoolForkCreationCodeSecondChunk: '0xf93453d9650b667ba4291de07cff46be3a8f312ebccac2e885e8d5f1b6b7a9a3',
	securityPoolServicesCreationCodeFirstChunk: '0x375f3cd958ce418de17daabe6ecc0f0c2cdba1c7dde906ce0f7a1f637da9a5e5',
	securityPoolServicesCreationCodeSecondChunk: '0x46cd4f6f44de9a92f21949abc1dc74ee2ee2688e70ec25ffce08081c73f36ee2',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x8a7cc974129a2e8736bdbaed7d65879c5a745e6c6d5a623d0b73845cfeb0cf94',
	securityPoolSettlementBookCreationCodeSecondChunk: '0xbbc624a15ef1462f1e740d492bd2638a17778759874b5ce87dcc3b97a5224086',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x80a6b2ae9deadd5afd9f6c8e212ba774e4e0119984a29d88637a571873015895',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x30114430106a68d698ea3409f92ca3ab530caad8953b16ce768dab474531833e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x54f6963340aa7834f79b82dd708ef06c232200dba6abc878e361782174499c54',
		securityPoolDeploymentWorker: '0x0dc747b66bd35df59bf6303e9145ef0f3d458d2caf16c4386fa7d1dcdfbebdb2',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x52516a58615719dcb3e4f45a80562d1f7b8c75142b318041e2ddb6d52d0dd5fb',
		securityPoolDeploymentWorker: '0x1c9368e6fd53184850e9d1b27eab8d11f0ac567268b49ca675b6a9cb5cb29008',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xae89689cf622643bbe8e304065a7c45c58b1b9dde1795c56f849251370b0075a',
		securityPoolDeploymentWorker: '0x216d6bdc53b117970efe79f3a6f3153be0086396e5b52c5e112e66286b5811d1',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x442b540887dfa3156e9fd2643464fe5be7a75341ed75871e2174b8b8cb36ac81',
		securityPoolDeploymentWorker: '0xca22b332bcb459ff2b6b293945f40a3e0cef11e6c2178f107b3357f38a3a8d9a',
	},
	deterministic: {
		securityPoolDeployer: '0x999ba7b1002850fe517cb36eacb51b2da7fd3fc6be6d2917ff39d757efa7d98a',
		securityPoolDeploymentWorker: '0x7eb7758488030330442c4d66336efa1ac616baf4084f02121e04097c98d81c9e',
	},
	mainnet: {
		securityPoolDeployer: '0x1ef4b1f38351d70df0c337fab8a3625e017e3540882fefa52007feb890649665',
		securityPoolDeploymentWorker: '0x0ca3f9f71d4141e164c42c99bb7e401215f65a4313ea05be84cfe27768398bc9',
	},
}
