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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x25579afab97347f70731b3e7083f8608cb87414c0804363167469904524d1ed9',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xa57596e5bbc73fb31e5dd9e6355f9cf6cd638bb34e7ad013b6db52ceec4f1a8f',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc82a6fa7937bf0ba34b60306af3d9224bdd80c6b038d9e37d0e8f02a4ac4bd7a',
		securityPoolDeploymentWorker: '0x7a5a88cb74d77e6c2af106cf4330ef3a904bc5743b4166e00df34f4856775aa4',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xab30a14d243c88df05f9ca9d9c917ef19d9463c756fbd7d32cd91d6dab18a15f',
		securityPoolDeploymentWorker: '0x0f140acc9f243554abba1dea961ca29016eba8f964de71da180b39764599a250',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xda97e4ab31de5ae1946c1693d044073c873a4cb73d4a096eb4e79988f3a87bae',
		securityPoolDeploymentWorker: '0x60ce3c0674b38f7828a203003ac88e277b1e23c006a8e86a496fa715d7a268de',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xec06b344f44e0beb8f0f6606e751c554833ffbc1f86bc2ab631a648fac9b2770',
		securityPoolDeploymentWorker: '0xb4291c0df0cf556a067034a895091b40cf2ffd278cdc6bb2a5adf5ba126b3d5d',
	},
	deterministic: {
		securityPoolDeployer: '0x6ee6893f5dfc69915c9b5d834dc1fbce8b6595cac13bcdc305850c7710b9a61b',
		securityPoolDeploymentWorker: '0xb74430a9c79da5622f12e9424f676a2fc2a931f390c1557792c8007eeb9af878',
	},
	mainnet: {
		securityPoolDeployer: '0x5b3e5c33902e84afba1b11a17089b8fa19d40f4344eed6679e14ed3629c104bd',
		securityPoolDeploymentWorker: '0x71a53146435416db835ca2bd70667404f49ddd8fa1c43053c49bc5b5b8a28b05',
	},
}
