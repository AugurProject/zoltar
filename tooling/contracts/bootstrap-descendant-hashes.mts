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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x08a91fb762e56fe4a3c12faa27c3daffb8c03724739eb243fee0f7609685c89c',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x0fe438fb7e40d481e3b99ae8754761c1f986dc5fa1b44e16f1130d6e0d4f8a89',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x8bdbd1966cead13dc46dd22046c6e75962a0f11ff55ea69cc690c98bd3c3de5d',
		securityPoolDeploymentWorker: '0x5d76c2c48310623fe1137ee531f895d13b99524e838e911ced0518a087feaf98',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xcb275851454a3d1cd39c94eb422a0e5be2614c9eb0d9ff48b2dfde4e9a757894',
		securityPoolDeploymentWorker: '0xa054d79dff2068b21205f1d0e906125757b8c259cecb2aec36bc15135577d383',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xe9bd4bed3b427f6aafe98cdfdbb90eecca44174aeee831dc159511590322e90c',
		securityPoolDeploymentWorker: '0x53ec854b01f4796d74acab3be2be304d0d4e9aa7d472c51a674eca60e0952799',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x8ec54b19a174a708d145d1e97cd8ad05d133b84343d06810e5c0d8084c0d56df',
		securityPoolDeploymentWorker: '0x94db136e16661013a19ae9ca24f6f15c8af2154e4419a689e011b33295c079f5',
	},
	deterministic: {
		securityPoolDeployer: '0x302262d00c6d31250b5e7c1f99909c37b6c2e629a9ac0ff613584bbfa0e2d564',
		securityPoolDeploymentWorker: '0x66f24dae7a7c6109baaa53337f47c3d97945b7555e307f92ed62ccc272ff187d',
	},
	mainnet: {
		securityPoolDeployer: '0x0ea03d42ee85b6a452f96fa22539c02bd8d9efda2b38996c4506ba5fb01252d3',
		securityPoolDeploymentWorker: '0xe1270f1a1c35bb75442e9dc9e974d1a638933d9bf7fc2fd629c3333ec47d1339',
	},
}
