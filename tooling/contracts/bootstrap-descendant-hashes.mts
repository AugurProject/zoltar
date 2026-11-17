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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x1cad7e9233fad438bb7625090c844fc26728d05e9073f5da061cf410e96163e1',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xd012e99c5c9ca9d726c87449513d1c614eef99c1f700bc50fdc579f5edf693a9',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x808c27c9f2253b16eccb41f216804d1c3e3f5f46dfebc3d57f4bd136370c9730',
		securityPoolDeploymentWorker: '0xabd9dbeb1bf953b0f3ad2e05a8f8ccf99d599a4aca5dbad28b5ebe611ea0a59c',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x3b584b4a251aedced783ef084b5d365260869be7e22f0eadc2da2ad0a7d83df6',
		securityPoolDeploymentWorker: '0xea568714be58cd6ea575c1f9bb4a470eaecee8f022b413f5f7749819aae77c76',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x511ac5b8adb9e7b0e6c182df819dab1ec1746c071a5e4296ece3da1a29b300c2',
		securityPoolDeploymentWorker: '0x07d3473e13735d035a4da88709b544c88495dd6e24fd71f20a45292944da115e',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x20cae4acba369fb51a316e59af529a1e8af65a5ed8015944d8b32367559d64f8',
		securityPoolDeploymentWorker: '0xcb04d7b9496fa577936c34e99906269344c6659cbee4fde667ef1e4c92db60b7',
	},
	deterministic: {
		securityPoolDeployer: '0x98277762466f0245147fd904e1da8650a9dbc3554598348bc162d86e5899fe6b',
		securityPoolDeploymentWorker: '0xacc9310f39dfd5cf83a141314ea2c565f6be60cb976881e39f673688989a6d53',
	},
	mainnet: {
		securityPoolDeployer: '0xb1444f85b29a32f680b129f52543c494f9878d1953944b0108241bbb85b57dd3',
		securityPoolDeploymentWorker: '0xf7ae285952125330e7bb9e536b532d842867aab4b498e81f28298bc1dd7eb511',
	},
}
