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
	escalationGameCreationCodePartOne: '0x751b397bda35e9cbb1d566bfe152c8fff349d50148c2f83693e983fb082ac8ed',
	escalationGameCreationCodePartTwo: '0xda0f685a17b91fe41c94234c902cfcbea8bbc48b914346a43a016d0fcb641dd6',
	escalationGameProofVerifier: '0xae36c0b208871ec2ab53bbcac4fd1ca7d2c39e1a406889adcd12545127b0d2a3',
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
	securityPoolForkCreationCodeFirstChunk: '0xe1cafd606a7b40e4e249fb26189e2f70ddebd844755f77708c524ae9ea9f22f2',
	securityPoolForkCreationCodeSecondChunk: '0xf93453d9650b667ba4291de07cff46be3a8f312ebccac2e885e8d5f1b6b7a9a3',
	securityPoolServicesCreationCodeFirstChunk: '0x375f3cd958ce418de17daabe6ecc0f0c2cdba1c7dde906ce0f7a1f637da9a5e5',
	securityPoolServicesCreationCodeSecondChunk: '0x46cd4f6f44de9a92f21949abc1dc74ee2ee2688e70ec25ffce08081c73f36ee2',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x25579afab97347f70731b3e7083f8608cb87414c0804363167469904524d1ed9',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xa57596e5bbc73fb31e5dd9e6355f9cf6cd638bb34e7ad013b6db52ceec4f1a8f',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x5c2dc4c85e62587e0f8846cbaacd809f0ac69e7d69f032a91b265a5cb1f8a1a3',
		securityPoolDeploymentWorker: '0x0b932ae6cf26a1d651d8a348365af6aef69c5ca10c9e6d6aba8c6f5882a1d857',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x64f2f16b6694ab32aa6f14bf5d5d80fdeefa5a80b588fcfe6876eea555d10d98',
		securityPoolDeploymentWorker: '0x3cb61485be0758519c458615aff0c0404a3347548d5f03da46aaeffa3d9039ea',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x820c7b46a806d57a09c4b820be0c13ba087a76906f0fcddc2d37cad31a726a2b',
		securityPoolDeploymentWorker: '0x22b277ff254d52f7febc7be13351188b9cdedb04f59abd092288e630c6a31400',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xe2cae36b1030e479a505c18d11e84c508754c5f5d841d05501703137bd50512c',
		securityPoolDeploymentWorker: '0x9a7878ce2d640e9861c193c6151770ed19cc81dcb7eff3b8443d6603f22eda7b',
	},
	deterministic: {
		securityPoolDeployer: '0x65b9f86331937ec806580824d5da97ee9c04575a63baeaaa0f517d4451b4084d',
		securityPoolDeploymentWorker: '0xb2eb8f1985a47d91ef627d46cb2ef49b20938460c3eb0f2a775d1d27b2caf677',
	},
	mainnet: {
		securityPoolDeployer: '0xeb2676b7e04f2645cb894f22e8b339887f1f6df142dfd8e808aabb32050a4036',
		securityPoolDeploymentWorker: '0x92df57b2c0a9895cbb454d53d3544134797b9769757641adfc3daa0158959c76',
	},
}
