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
	escalationGameCreationCodePartOne: '0x4dad76949608e97f6bd83b51871671f02caf7d1384f311a7ad8a1621efb65571',
	escalationGameCreationCodePartTwo: '0x1fef09141e0947e475bb9baf5563845e84f595aad8a635e7c026372144badbed',
	escalationGameProofVerifier: '0xae36c0b208871ec2ab53bbcac4fd1ca7d2c39e1a406889adcd12545127b0d2a3',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0xe3c6a709d60b597ae8dd47bb254ded6714a1a1d01d91841d6675b4b94fb87368',
	securityPoolAuctionCreationCodeSecondChunk: '0xa6065f12114551f0046b3fdeffe01d9b191deb8adc9af30dae31f8344aaf2cc3',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x0f4d3c9c483920946f93c3e390db8c5bd65239f8040bf8d7897391626914006a',
	securityPoolCapitalCreationCodeSecondChunk: '0x918a46d22cbb9f66388cd9dfc07ac96bebfb2be77d59e980574a4c608c90a399',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0xe1cafd606a7b40e4e249fb26189e2f70ddebd844755f77708c524ae9ea9f22f2',
	securityPoolForkCreationCodeSecondChunk: '0xf93453d9650b667ba4291de07cff46be3a8f312ebccac2e885e8d5f1b6b7a9a3',
	securityPoolServicesCreationCodeFirstChunk: '0x531a73910b4eb4f26a9116bf9e53e42f9a180a06068bac9a7e21a9e169c5f4b5',
	securityPoolServicesCreationCodeSecondChunk: '0x0c7fbd85e56cd9dfef07339f985592d262120917630085db2e82b0f4e9247c7a',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x89bb50cc11e6458e16dce9051cd701edb32cd79a68ab2184a86c3fa33921f1e0',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xb51c84fb3ee42b5ccf60df4b4e53c81ff4bd7f1df6ce1df7870a4e3c5c0b4c43',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xbda36f8a5937a0daf1c1b11210ec3f39a719faafed8a80032f9e452d94edfcfc',
		securityPoolDeploymentWorker: '0x11b91fb4129838a6fcfc26e0aa94b447dd633774c0a5ff88e139d1f61642ff64',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xd663e77b6bbdcdc2efcb3d835b43339c5317a4be610898da43789fdca0829039',
		securityPoolDeploymentWorker: '0x105ef980b51add8b62fab2cd45adc010a608db791052d331bc142cf78fa98ac5',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xa32ee925a4cd757a5f0b716dd3b04bdfceaf4cf3b81a99282c8e9321340f4d23',
		securityPoolDeploymentWorker: '0xd8cbbdbf66d65b126504b5f479631fd68c15fb7bd249717821d703541606120c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x52c851f265d65ef20d1825e2ae5b4a095fe119a4c5877cf2095a97c9bc36739d',
		securityPoolDeploymentWorker: '0x918b5b6721e3488cef48a21ba044ade1a533c719b33a9d3a82bb4e7feac20138',
	},
	deterministic: {
		securityPoolDeployer: '0x24ec774efceb858eaf0ee14660e19086850d615f2ca96510751dd46fab691c71',
		securityPoolDeploymentWorker: '0x1fe700e97bcc286b91df6ae586b24d3c6344c0066b20138c93ef014d758969bc',
	},
	mainnet: {
		securityPoolDeployer: '0x512669f2452a46d365a90fbf7cf59944ff0df147569c3d693f3788fdb8bc3166',
		securityPoolDeploymentWorker: '0xa3246bed72b6d0a8da4a64407a4498bb0732b990e347683e293bf711ded70d3e',
	},
}
