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
		securityPoolDeployer: '0x0b28583a8848f3751d6ce2373cc5ca19a5a9cb191dcf43b23768e07d8606af32',
		securityPoolDeploymentWorker: '0xeb3d1b78c3f88eca761aab27e4e785fc0c3b61c3c560d8efe7e1d29919e25229',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xa449f9620cc8a99490e3920e0890a66fd0f972d3eee2f67c1ffb9f118c6f7ac9',
		securityPoolDeploymentWorker: '0x5d45bd656e492af234ab9efffe7f8d2d735892c5022c1f5c64b7d4cfb21d7d28',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xe37cde6840dd0a7b917f53511b084ef07e50c2fc5ad8d45769297164000edddb',
		securityPoolDeploymentWorker: '0x4bd88c7882b9619078ea569c75c71de006f901a159dcf77578df9ac32667950e',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xf7c91760d7c03815137c08f932b99b044b4eb297e534504c97f11f593b11cecd',
		securityPoolDeploymentWorker: '0xb32cfba950dfad2019320e4b1a4ff8764a07ce3bf8efc88218413b83f4284e54',
	},
	deterministic: {
		securityPoolDeployer: '0xdc68f6e763cf73cf7c3c6aa0bc2a0af4ff7508cec8398d802f303d7687c0c683',
		securityPoolDeploymentWorker: '0x1a2d552b48891e1b3e50a5112366ee24e213c7115726723c38fbe1d2d814f50c',
	},
	mainnet: {
		securityPoolDeployer: '0xae5a6e0a3b58506f1b3e68617c7d63aa4867c64fc3d7f9be4f0ebc00dbbbfc24',
		securityPoolDeploymentWorker: '0x919431bd780e3f63ca7222aa4e2c670f9863455b5d5aac2930be483280e98bbc',
	},
}
