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
	securityPoolSettlementBookCreationCodeFirstChunk: '0x917c2e6fac057a4c9e5049160dbdeca5f7cf8473e4ac19e4a19f6f79ac7e3f3c',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x13932cbeea6b5652b781b74d92b78382c41e186bfbcf5eee04f6d10094ad5b4e',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x80a6b2ae9deadd5afd9f6c8e212ba774e4e0119984a29d88637a571873015895',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x30114430106a68d698ea3409f92ca3ab530caad8953b16ce768dab474531833e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x2d42e802fa542f7683ba798eead3c60c3b7647768017b86ad218c624c9501be0',
		securityPoolDeploymentWorker: '0x77424ea2ef7082e93929ae74ea138daa6bdfae4b53c8a80848a7e2897c7efda7',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x999eb98498c215c2a165d6e975dfc372f45f66ec88f7976a74152f736caaef18',
		securityPoolDeploymentWorker: '0x020987ac02a42845981f782ce7a69e856a2d95eb74da612b826fc13c5c004704',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xdf6827e45bcadb9ce5e5f787df274483c6025d0c9263c2dd7ccc8febd74c4dad',
		securityPoolDeploymentWorker: '0xf3c5cc3f6c527ac44736a7c07127013723f5135b994718ae4f64f90e408c41b0',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x231d07ed5a2385096110f1f28ebfe940234f2d6d4b492f4c095320f76d51d846',
		securityPoolDeploymentWorker: '0xeef228f371d66a23805654f4ea57de298bd5a05b1c8021873de45882eee70f61',
	},
	deterministic: {
		securityPoolDeployer: '0x1d82dd07dd834c0ca6f8afd2fb415d3b1274f838fb9aa74951d319a3ab5388b6',
		securityPoolDeploymentWorker: '0x2a5610b703fcaa434a7b823c01fe7b774e31630e123560fe53f1d3cb739e123f',
	},
	mainnet: {
		securityPoolDeployer: '0x61ede6827b24ff7e329e4a56cc51a714ad378ce77fe2efb0acdfea05ed2418f7',
		securityPoolDeploymentWorker: '0x0433deddcb779c60c15d162f4e86c40978cdd984a0d823921c0c80779ece49d7',
	},
}
