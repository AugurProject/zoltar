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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x25579afab97347f70731b3e7083f8608cb87414c0804363167469904524d1ed9',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xa57596e5bbc73fb31e5dd9e6355f9cf6cd638bb34e7ad013b6db52ceec4f1a8f',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x73a7b79b391810c53357a93cb4926cf503c72a5aa5ea0020d3edb66d97b6908f',
		securityPoolDeploymentWorker: '0x064cb39be55c8fc646a746ea59c58451611d6ab183b5f736fea124825fe09163',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x5649c9523947efe5a26ec6e4ff1923c8c5b4d5815f9ba67c1471f730a820fb87',
		securityPoolDeploymentWorker: '0xdf65209b82ea15c8c89e87c18152c8bd9a243c2edbce9974c43ef910c43944df',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xa56e5af520c48e89d1d6a14a2e28bf76cd1a5dc614141cae6dcc4e696894c270',
		securityPoolDeploymentWorker: '0x867dcc57d74ee6b6fbbb1dd640916d48602aa89c7d3878c8190d39649fe63fa2',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xf4581dd1f30c9b434fd0d3c936835b2acac716a377b7b7347aa6990260209735',
		securityPoolDeploymentWorker: '0x12a24822428d865dd2929fdd510e6a18a3ea2e52dcd8f5a0f7a3199e47140de7',
	},
	deterministic: {
		securityPoolDeployer: '0x19459f4eaad052aec03470b96f5bf4a6edf58fdc8ee7128bbf59b6fd8f66890e',
		securityPoolDeploymentWorker: '0x1fd0a66363a8ceb8f6e13f031f51bbe2ea234a59987f430cf59377de07f3f6cb',
	},
	mainnet: {
		securityPoolDeployer: '0x9643563b076af65d0832b4f3374c5c06ef65bb9489dac8c93904648d59482b72',
		securityPoolDeploymentWorker: '0xd81cb635dbcdec2bf2d56311ac19c5a03336180ca1957a0f3ab35fbbc524d502',
	},
}
