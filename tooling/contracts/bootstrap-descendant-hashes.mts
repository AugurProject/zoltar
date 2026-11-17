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
	securityPoolForkCreationCodeFirstChunk: '0xff1010fb15e3cd5b13be685ed1f8c31b628db6ba5c54281dd3e8aab9d5b7bad4',
	securityPoolForkCreationCodeSecondChunk: '0x8f46b99358cf90a6acdade878e05f001e6ca02ca97964ed2be7ca02117b49591',
	securityPoolServicesCreationCodeFirstChunk: '0x6f9a626b08127bbb0822cf0d1b7621e9b5d0bf64f15735b3e1c0c76fe1390937',
	securityPoolServicesCreationCodeSecondChunk: '0xadae7873855726c8c706df59eb312e3f1da401a3f428f58c627467079e3e70ab',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xf1c396181eb533a0654b4116e8466785468ac50f7d4b875f12d11c8c7d78ab16',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x8405e8f5092af0669abb9193c957a398231f76ea9f6573d4f22b185227e105cc',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x80a6b2ae9deadd5afd9f6c8e212ba774e4e0119984a29d88637a571873015895',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x30114430106a68d698ea3409f92ca3ab530caad8953b16ce768dab474531833e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x2fc394f7ae113275fce0c3a2fa1e88996933aad11ebb59eccecf9b0bca7a2053',
		securityPoolDeploymentWorker: '0x7c019ad7b3e18cafa613c239e1922827d9637540699bf0c0752012197d658ecb',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x648cc51e5b6f630ee490c5193a697b54c7206139fd7794acdf5ba02a1dd20f7c',
		securityPoolDeploymentWorker: '0x15a9b7be980d7cc09c6e503d0b38c18a3f0c86a5993cceb26e6f2b603f43252f',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x207761cf98b47a48a67bc41fad6b777609ed292827b207007a564435fe8c6e6e',
		securityPoolDeploymentWorker: '0xd0f07ea2feb5091451f3708c27bc023edc0e1f718b108df56f3320fd5fb03e92',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xe0ccb745a4e8861f4608a53c38efd502f635f9f8e392da0dafcd4c9cdeceb2a7',
		securityPoolDeploymentWorker: '0xfd1cbffeac4f9eb521d400b964fe5270f16b4d1d57b797669bff8937aed77180',
	},
	deterministic: {
		securityPoolDeployer: '0x70be5378b2f21c15ec8de54d9210f5f59bdfad01eee4ce853abf9f4bae8481c7',
		securityPoolDeploymentWorker: '0xc2c0c5ff880349443e6ced0e04c7f99b7cb63ecba20870d39ec90129c4198f14',
	},
	mainnet: {
		securityPoolDeployer: '0x5550a738a7b6d83ce7bc56e9248a7873cc00293febfc98123077d03ab231483e',
		securityPoolDeploymentWorker: '0x71acff9117b3fb441cf8b4d3ffe91dd6082e114a01c55550e02a7c015e99a858',
	},
}
