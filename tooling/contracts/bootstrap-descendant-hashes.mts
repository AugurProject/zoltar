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
	securityPoolSettlementCreationCodeFirstChunk: '0xafc7756739b031ddac7220ca938163ba11b7894a888f8f69041bfbc9b8927e23',
	securityPoolServicesCreationCodeFirstChunk: '0xd11ae818ea9a264faaaeecad02d1ff682f8e327897aa251b4ed4c7d48097311f',
	securityPoolSettlementCreationCodeSecondChunk: '0x52d54debd943ce09da2c2ee0250bf739610024522f92177e5391c22092a7277f',
	securityPoolServicesCreationCodeSecondChunk: '0x48ed8173448e5c6ce1d33a774c390867b66e6407faf225c6bee9bef246ecdee7',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x1cad7e9233fad438bb7625090c844fc26728d05e9073f5da061cf410e96163e1',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xd012e99c5c9ca9d726c87449513d1c614eef99c1f700bc50fdc579f5edf693a9',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x0dc2aef63dbcef4380573aac47266fdefcf25ce5c152e2b042099448c89e33a1',
		securityPoolDeploymentWorker: '0xb5f7f6b4d2c091da23e6c5d36d22e6c5e72c6f03d1a684e6ffecded7969a02cd',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xe3e0c47bd235a7124856bb13569d27715a3883a198a0a2bb0b0421976e047c46',
		securityPoolDeploymentWorker: '0xe15c88e95134d48bc66a974fbf8c743cba7f1895e3bbd32be21011bd130c5e53',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x33d335ea2bb283b609df9bfe5502ec01a16324db392a7dfcd31de5f1de66039e',
		securityPoolDeploymentWorker: '0xbd9ae89c40aa57a5f4c3489d7183a2b518a7ce2de19c569449dd5738e311f72a',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xc86b57569978a59eb93176c5dd63be54f3d8e1a6a47de27bb8d578f232bbc3d3',
		securityPoolDeploymentWorker: '0x29c7610a2787482e00d758923e61895d273141c85535d94e144033556bd88268',
	},
	deterministic: {
		securityPoolDeployer: '0xf7149a683ce7fddc5505cdc13491c91416a507818e9e82476bb4aa84364d209e',
		securityPoolDeploymentWorker: '0xd0ec905e6eb53496614f7687c7796dcbad79c1d7140fec5a75cd23cf3b7bb330',
	},
	mainnet: {
		securityPoolDeployer: '0x50e54bd852105364487efa6dada25ef91eecb21d11a2683dcab71816caa7a208',
		securityPoolDeploymentWorker: '0x1e7b9c6d3b5d7ddfecd6f8c082d83d051069e8fece21aabb265118661d93d55d',
	},
}
