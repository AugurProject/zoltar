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
	escalationGameCreationCodePartOne: '0x242ce7c137ca6b7c01e54287713c6f120963d17f79845287409662c237305855',
	escalationGameCreationCodePartTwo: '0xf62139822dac2689459df02a607d5bfa58d76d1a8176e961ba7d520cb1760e3b',
	escalationGameProofVerifier: '0x37b5e9e91983a55ca32d9084a7a9e3442a89b73e1901c8bfc0cc3b7e006099a4',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0x87c68ce4be02c1314cc2a3c96d4695e5dad0f3db7ae14a73849cacbe5b31d3a6',
	securityPoolAuctionCreationCodeSecondChunk: '0xa7f49f45e915eb19883fa960924d7a1c05eebb9f5a3e2528289c35535da53e32',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x240e90e678c96559c54234af3266b8b7d9b29a9bbd11b1078e16b0a3198f6473',
	securityPoolCapitalCreationCodeSecondChunk: '0x23c19e92299c3306c97499a3fe37e79d52431c1999fd0b166a0d0f4fd1271fe5',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0xff1010fb15e3cd5b13be685ed1f8c31b628db6ba5c54281dd3e8aab9d5b7bad4',
	securityPoolForkCreationCodeSecondChunk: '0x8f46b99358cf90a6acdade878e05f001e6ca02ca97964ed2be7ca02117b49591',
	securityPoolServicesCreationCodeFirstChunk: '0x6f9a626b08127bbb0822cf0d1b7621e9b5d0bf64f15735b3e1c0c76fe1390937',
	securityPoolServicesCreationCodeSecondChunk: '0xadae7873855726c8c706df59eb312e3f1da401a3f428f58c627467079e3e70ab',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x1cad7e9233fad438bb7625090c844fc26728d05e9073f5da061cf410e96163e1',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xd012e99c5c9ca9d726c87449513d1c614eef99c1f700bc50fdc579f5edf693a9',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x9b3fdf76e3811c1c070b291b8123aee115c7b1824554741e2eca2a44a15b512a',
		securityPoolDeploymentWorker: '0x58728c2da537dbf2212604b4f18b02e22ec5221629b9bae8a81afd92f71bfa41',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x09a0e61c154665a92e7d39242a9a97bc9ef05f6c4b96b3ac76976a5243d9cadb',
		securityPoolDeploymentWorker: '0x96078d78da12a5af6c61d940f270c8863b69c754249743c6780c18be64546e18',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xdcc116cf37fe9dc7eaf147523c00799103e77b8d8977f050acd84ce87aa521f2',
		securityPoolDeploymentWorker: '0xdb6de0526b876707b15fabcf0a27887e12f93b6e4c675cc305b3df047e911ab0',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x984effe2c2cead09b6ae44cb35d5509d177e74903df6b144c69eddc6be506dde',
		securityPoolDeploymentWorker: '0x14f3bbaf6c1b3c1c998f997d3eb4bd46f09a6af0aa289be07ba4e0bb51b5a7b1',
	},
	deterministic: {
		securityPoolDeployer: '0x416ac57394d6d9007f73b859fe2d3e503c3c84c9208108b4f43ab00dd94c5aec',
		securityPoolDeploymentWorker: '0x222723a2e71d9ec0441582b2df40381ddae79ac05bed38b3627248d70ebf7adc',
	},
	mainnet: {
		securityPoolDeployer: '0x5de9d9ec4fd081cd282fc60409cfc9a2df7793a55623b03423ee82fe3a305f50',
		securityPoolDeploymentWorker: '0x309ff7d791dc4e262ba341b93056571d5b60827aa92a42148dbbe59efd8687d2',
	},
}
