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
	securityPoolCapitalCreationCodeFirstChunk: '0x84baf3657948e2c0f7eb14364e1ae9f1b061265868d572fbb6a5d148f232847d',
	securityPoolCapitalCreationCodeSecondChunk: '0xdbff69b9c292b004da62c0142fdb72f8666593f94a8281835005f107b0026852',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0xff1010fb15e3cd5b13be685ed1f8c31b628db6ba5c54281dd3e8aab9d5b7bad4',
	securityPoolForkCreationCodeSecondChunk: '0x8f46b99358cf90a6acdade878e05f001e6ca02ca97964ed2be7ca02117b49591',
	securityPoolServicesCreationCodeFirstChunk: '0x6f9a626b08127bbb0822cf0d1b7621e9b5d0bf64f15735b3e1c0c76fe1390937',
	securityPoolServicesCreationCodeSecondChunk: '0xadae7873855726c8c706df59eb312e3f1da401a3f428f58c627467079e3e70ab',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x8eca41426363f2123b52d20ea421c1c547b4020ac5d2b738ac1d3fe077c740c1',
	securityPoolSettlementBookCreationCodeSecondChunk: '0xf722ca05e3b7471918ad98680224de81de4a1e6d450047e7ed7b3edff1a96269',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x08a91fb762e56fe4a3c12faa27c3daffb8c03724739eb243fee0f7609685c89c',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x0fe438fb7e40d481e3b99ae8754761c1f986dc5fa1b44e16f1130d6e0d4f8a89',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x8fc45f819d389f0e489d0351b7604fd5d1f86cfde328975aaa912924360f2710',
		securityPoolDeploymentWorker: '0x5cc78e905694187915578a678ff472e546fbeae95801c5189241e6f5e14527a4',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x827516c5d863453e124ae853ff99e28d9dd7c1683a5d4130318e40762d2bc240',
		securityPoolDeploymentWorker: '0x5e3c78c0dc81bdd05f0e2129e6fa3a839d116fe5dcce38dedddb7c0bbb8f645e',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x388bdc7d0276664162fa75f977e8fc25c3f7795ddaf0479b58d2f5fbccf77929',
		securityPoolDeploymentWorker: '0x091c700fec988c10e034e45596a7b1bc742734714d1524189b0d1c7abfef778a',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x2ee4b8259b6be0c5b6306b933106d1a8c3f29a3a221d051b9e1081eb664ccab3',
		securityPoolDeploymentWorker: '0x1051994c04f2ef3c71520189835631ac441178c3f9c97e595b9cfc1b217daab5',
	},
	deterministic: {
		securityPoolDeployer: '0xcf00a05a585aa39f5eb503a0fb07d574f23c7336c49dd91d87501b0f2e5309c7',
		securityPoolDeploymentWorker: '0xa554f1f601ba2d2fa19a1b5ca0f58ee68401d543c29ed166ed3469a916637f4d',
	},
	mainnet: {
		securityPoolDeployer: '0x82310c2716d457a246b2ee6771d48a0ed989ce4ef92b52673bad55ccbd0fcb3e',
		securityPoolDeploymentWorker: '0xe2e3d28a413d1bf912e10eb91ec61fe8f0217e893ff2273cc35cb1595f59d63a',
	},
}
