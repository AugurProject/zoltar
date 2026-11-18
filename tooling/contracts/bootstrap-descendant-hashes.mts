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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x6b0463ea550a3e1a983abf29008c1728839811b35cf84e5327812ac81288b804',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x2bb6c94ca89e47c511cd3bd3e99692498805f84d972ae7ecb982b119ddb236ad',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x940af66093fd7ce40020b7c82521fd0981507004931bee4f8a9b844a7c46f7c5',
		securityPoolDeploymentWorker: '0x5d73d24ae686f8ee431465c7013061f7f5688569af35a48109ffaad2ef3b6a6a',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x6ac94de4c2a9a805467d3bc295a631cd63b4ff6cdea0a8c434b595f489186f51',
		securityPoolDeploymentWorker: '0x176a53a61bf93615ddaa9c9943b138b28ed00c3d4618ecf408160e59a580d702',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc6aad0e77ec7ef19034beac952a393783a78c0e1e1752d50d79441cdcfd6e554',
		securityPoolDeploymentWorker: '0x2c25c44a4feaa96a3f2b43e2bbbeab882b24b63b81ed127eb458b980aff2083d',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xdebdff6d373d356d199b4fe02aa39c22290ba051847897e632bce5a9ecf29936',
		securityPoolDeploymentWorker: '0x91318832b57c25b8b4e0afce5245d3c0e99fee6c840b0123e0ef2242c00decb9',
	},
	deterministic: {
		securityPoolDeployer: '0x78e3ba617e406b1991924d8722ab64008d0bc7e9f73b04fa0517dd01948c9451',
		securityPoolDeploymentWorker: '0xdf200c508ce630ca0c087bfe275224abaee687d5373c588215a81475f384ee35',
	},
	mainnet: {
		securityPoolDeployer: '0xd47854bb4a498e353e8e4bce88ef55bcf8a62649feba1a5416bf2ab4755672ad',
		securityPoolDeploymentWorker: '0x1327a1f2dea127b4562dd88e650d4dae1a715f5a805659f4ce90d32c651e522d',
	},
}
