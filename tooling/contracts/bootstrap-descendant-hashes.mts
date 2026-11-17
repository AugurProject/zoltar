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
	securityPoolCapitalCreationCodeFirstChunk: '0x240e90e678c96559c54234af3266b8b7d9b29a9bbd11b1078e16b0a3198f6473',
	securityPoolCapitalCreationCodeSecondChunk: '0x23c19e92299c3306c97499a3fe37e79d52431c1999fd0b166a0d0f4fd1271fe5',
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
		securityPoolDeployer: '0x2fc7abdc9c79ccc5dcf5543ac5cf593f95a4451cc1eac51c2cdf088c5abc651d',
		securityPoolDeploymentWorker: '0xe1de705d6882bf978489f984256b02176c5613dc700b7a19120b4058f802de9d',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x59edcc7f8158b3e311fa509798f1058a600ac9d1cc78c6d943a69cb47285274e',
		securityPoolDeploymentWorker: '0xed6640d5f86b27f91f87a9123ef075875f7322c60904e66b6b18537c711b579d',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xb96d55ba3236cab61e9fcc429da35472d18712c6a92e51ac864b45e8f5832115',
		securityPoolDeploymentWorker: '0x36f52c602b64598dd7e4f5a67b35ba32f3adee38d835b6edd967e4a6616e3cae',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x4b86363ba6aab64eb908fc6ebfffd1b72b2de9f1dacadbd10da6da13baf328fa',
		securityPoolDeploymentWorker: '0x5ae0c65a1ce815b07db21469d9faf473a855f448d0f9b2845492e253f722c7b6',
	},
	deterministic: {
		securityPoolDeployer: '0xe7dc6feedacf153d3355333e75231240d0c793518d80f13bcd2adcde66ef9d87',
		securityPoolDeploymentWorker: '0x24ff8c055f7d45ebe4bd7d34f19e32b5e5936275be1f200845fca2a84e9a30e2',
	},
	mainnet: {
		securityPoolDeployer: '0x0442a709b48a895407b6f14f9f4dd07e84cb658ee454c220320ab3db15329cb4',
		securityPoolDeploymentWorker: '0xc4b721997ba56607eae8ef82b6322db8d5e61c9b7f37c84290becfcdccb1fbaa',
	},
}
