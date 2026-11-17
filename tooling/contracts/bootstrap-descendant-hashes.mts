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
	escalationGameCreationCodePartOne: '0xb7a3c8b44ccc29913d56cf8719658689a26a32de34f2f95ef1a93cd96022f92d',
	escalationGameCreationCodePartTwo: '0x47ba57214eda99ab7f4f004eeb9d7b5c1e51229f6e6a3adce8158dc08d30d074',
	escalationGameProofVerifier: '0x37b5e9e91983a55ca32d9084a7a9e3442a89b73e1901c8bfc0cc3b7e006099a4',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0x87c68ce4be02c1314cc2a3c96d4695e5dad0f3db7ae14a73849cacbe5b31d3a6',
	securityPoolAuctionCreationCodeSecondChunk: '0xa7f49f45e915eb19883fa960924d7a1c05eebb9f5a3e2528289c35535da53e32',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x84baf3657948e2c0f7eb14364e1ae9f1b061265868d572fbb6a5d148f232847d',
	securityPoolCapitalCreationCodeSecondChunk: '0xdbff69b9c292b004da62c0142fdb72f8666593f94a8281835005f107b0026852',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0xff1010fb15e3cd5b13be685ed1f8c31b628db6ba5c54281dd3e8aab9d5b7bad4',
	securityPoolForkCreationCodeSecondChunk: '0x8f46b99358cf90a6acdade878e05f001e6ca02ca97964ed2be7ca02117b49591',
	securityPoolServicesCreationCodeFirstChunk: '0x6f9a626b08127bbb0822cf0d1b7621e9b5d0bf64f15735b3e1c0c76fe1390937',
	securityPoolServicesCreationCodeSecondChunk: '0xadae7873855726c8c706df59eb312e3f1da401a3f428f58c627467079e3e70ab',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x25579afab97347f70731b3e7083f8608cb87414c0804363167469904524d1ed9',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xa57596e5bbc73fb31e5dd9e6355f9cf6cd638bb34e7ad013b6db52ceec4f1a8f',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x8f707207039a448d998f6a768d3edad5a7ef14d6429325a105758255f91ddea9',
		securityPoolDeploymentWorker: '0x96cc3f7b7c48b316711bb5ac58fd4c55d09455f1ee23571ee42f58acb964c066',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc0113ad8d7b90e73d65358de54e48e8bca39829029638ead49a912242fd3fc11',
		securityPoolDeploymentWorker: '0x9d8a7a4770cbd6f9a91236164321cdc9edee69799a2fb073fb8234348645bc89',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x09af2af4e4cc9fa6c562b5b5681b1d5a3176fc325af1df30d6240936182ffbe8',
		securityPoolDeploymentWorker: '0x946eefcdfd91523a078e737feeb601d7ab219b8463402d2d7de7600634f592e9',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x1fe2ca4ca5322cf372fb27aa29b6b174dbc30c306a8280b024acc5deb5489d21',
		securityPoolDeploymentWorker: '0x46aec1a66bc9cdd44397c0b688b381f1b6fcadd9b3a7f272b97f3c484eb573ce',
	},
	deterministic: {
		securityPoolDeployer: '0x1f7ccee784fafebf8ab478e2b0fe06b4105315ddb25d899d06f1d6d26e88b8ea',
		securityPoolDeploymentWorker: '0x2cdd44f04c59888cbdc09c941b041ce0b231fc0afe68fcfe0168307a0a9deeea',
	},
	mainnet: {
		securityPoolDeployer: '0x8ce3a1cd7875e1c947636645752e5e6092c9cd487e7426bf31910f70ca01ce19',
		securityPoolDeploymentWorker: '0xf0b4e39bd52b371ceffecd353c1122b39833a142f6ed102cfab879b982bfe3ae',
	},
}
