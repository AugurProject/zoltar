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
		securityPoolDeployer: '0xc684112e337c0fcc6bb55bdc470de9b207d91ec2b53a89bcf705ee7215daaba3',
		securityPoolDeploymentWorker: '0x015acda87821445ca852ec99af84efc94e24b00ce602ca7ea58b2dc05aa88633',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x1d85e5a59e7565b3d58d44d899dc30dc551a19bbe79a6c508b3387ee8877aa2f',
		securityPoolDeploymentWorker: '0x7639705be0210f5e8c13b6e795f568c9425e4c7bc8608abf5374219d62c729b4',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x2d6d1b9ae8f4fdbf049da742487af94188f0f804b33f98454b8db59b32a9456d',
		securityPoolDeploymentWorker: '0xcec0daf374362981a5e7ec9f5dde1dfc718821a7bbed229f8fbb171efb96531c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x7fdabd4adca69d3f435c260abdbdc52ccc5df04eeffac2f72bbb43ade0e8db9e',
		securityPoolDeploymentWorker: '0x72c36b850a4dfd4ea423ad346f56e81931cf2b8798dedbcd41a3ed2dc9efbab8',
	},
	deterministic: {
		securityPoolDeployer: '0xd5132646c6c58a63add6eb288658307cc09229aa81ddeceac5e2c7a4d4a4d055',
		securityPoolDeploymentWorker: '0x50af17ac1a1ef126d4418d900b3424f28a9b5f74d6e833e1ab6a9cd82fa5f396',
	},
	mainnet: {
		securityPoolDeployer: '0x1bc8f1349822e8e72e96889cb2e7b212154f98823bf9787354777f3dc29d3b4f',
		securityPoolDeploymentWorker: '0x556c2d7b1a7dfef34cb2b62a990e37858ef27aadffedfe450ece5b2a16434d9d',
	},
}
