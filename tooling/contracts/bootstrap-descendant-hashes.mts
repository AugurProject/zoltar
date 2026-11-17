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
		securityPoolDeployer: '0xd6c268a00f1a7747a8639b593cb1a6a2a961c921afbcf4772ab79a69a6606028',
		securityPoolDeploymentWorker: '0x250c6ff7d6ee95cf299d27585643687423f9cd21bafd994bc9441c4bf64dab25',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xeddedd80a759c31a4156fb9cb7976d4832573ddb2c5b8ec51ea694116ac457c2',
		securityPoolDeploymentWorker: '0xbb9d6d05cf0cddd48d749334c8efb169e3baaa7e8812c8d740d63c3e4bf71b20',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xd31e3d6af3b645c9b09cb2831d7bfb3422cfec2e88a8089cc3e9c2ea5a80b5cc',
		securityPoolDeploymentWorker: '0x4626c74523add2eda9e92f3b00f19166b8a1dabd649155aac5353c2f47eb2e1c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x69131eaf8ec76e7c52a65b620c24d6241af24876fb0c2142b33c390f2ecd2978',
		securityPoolDeploymentWorker: '0xc8db18bb0c14b4e03124e9ec9648832d8bea39dd84cd72a2cc2a99189c121ded',
	},
	deterministic: {
		securityPoolDeployer: '0xdee0ff3a318420593ed0e1466a71cf7bd80958cef258e1bb0040891e1d6143cf',
		securityPoolDeploymentWorker: '0xf0d6258752cb33a252f54b859ff4f08c3beb3cf7ff1457c30eed82515b728dcc',
	},
	mainnet: {
		securityPoolDeployer: '0x913f7e9c6b3428df6b5c1c3ded7b02931433dae943b848d4aac2dd939bb8c502',
		securityPoolDeploymentWorker: '0x9198fdb5010a6af0ca49617821b4df091d7f91cdf9e240246b27387654a4a4fa',
	},
}
