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
	escalationGameCreationCodePartOne: '0x66f5644d77c40fa398e0ed40b0bafd35aa9dfec0e1966b03e4a2ad783270e881',
	escalationGameCreationCodePartTwo: '0xd06a6bc394d0f6b50a5ed3098cb86cea01bf4ffb6d69f2fb41afb11e1f37537b',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x9b15366af2f5f73eadb261dc037082e3d1e0b7ba293cf92498cc1579024c0809',
	priceCoordinatorCreationCodeSecondChunk: '0xc2b31bdf6480d9d297ed73ae8eadca6724d8ab0f7ed5a8b15d641d4f6979b984',
	securityPoolAuctionCreationCodeFirstChunk: '0x47d9fa8acd196d5d9fc471e20d6f2b6a3c619eebe5b1c0c0491712213e858673',
	securityPoolAuctionCreationCodeSecondChunk: '0xd5a7fc6106d229f78f6618850e5cdbe012bafd48134b2580e71c04858cc3457a',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x6b9dfaf589800052661ace577daf2ac7e7bb2343edcbacc57bc8c8c8c74d766a',
	securityPoolCapitalCreationCodeSecondChunk: '0xa72f84ae7410e9df3c92f8ed5a29c6081156c5b20d4a1093abf5bb8a8335627b',
	securityPoolCreationCodeFirstChunk: '0x7084014d1254da7f0a00ccd9a768308b4693c024b7faa778e7d5fcb7362d544d',
	securityPoolCreationCodeSecondChunk: '0x315179e3a95a9c0a2c78ace3af8d11792723c99bd6615badf7ef6d3c4101b27b',
	securityPoolForkCreationCodeFirstChunk: '0x03d4635993dc0b32cb5b36ca808319c43af1d80b15e1a65f8191d59c4cd90802',
	securityPoolForkCreationCodeSecondChunk: '0x1b3725b94aca0348ee54a973d2a92cab3a358509ade7bc9e1be778fa43f01d60',
	securityPoolServicesCreationCodeFirstChunk: '0xaee57462e658f749ba406285378bfa867b99f47a065f6dfd9915e9f0d7aca629',
	securityPoolServicesCreationCodeSecondChunk: '0xf93a3f7da8339f41d519c981f9ab07b5b02f511d1bbfe14f404e016604bbbdbc',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xaf02e570a8ed8ca5ac7ca20d6ccd057173201805d536f225e130486eccbea113',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x5f54d478c9c1dfd74ccfc88711e4ffe6b7fd8a328af0a0f3b963e69feb2b27bb',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x253d40a26406943fe8e8be99681866a842d114a7b9c9bbd69ef789c94362d8dc',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xf933c10391e3508d350fe2b78c9cad8d6c40a4971deba5605233077e1ef65b58',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0xc2e834de06217b34b9c9bc8173d23c0d769355873e80694c273cfac71fbc1345',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x4ff08b06859036531830c2bc4fe173bed30281c70cf2007d547e895accbcfdab',
		securityPoolDeploymentWorker: '0x968e8734d590a5f8cac65f19577dc9417692e8d47c3750cbfd1eeeebe2eec4c3',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x846bc16da47476f24c29aa189362bd3d2fb900b6512ae13a48f2b0c85ab76427',
		securityPoolDeploymentWorker: '0xea48bf6059e0abffea3fcc74989088e7b332611daa339e1a0feab7c2f670d04f',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x49798d76b4e1b7771ab1fa076ae9376530df438487cbcd2af93387e85fae1009',
		securityPoolDeploymentWorker: '0x01e195f8c2a412672647ee5afe1c3ab7eaf2d426936b2b78904ef9c5610219c8',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xf92f7eeaf86ae3d74123d9d6036daedcc049ef4793a11c04515a87450ecbed9d',
		securityPoolDeploymentWorker: '0x9dfc4dd079b40567ecb6ce247c63ba9889b6ad034835e47a7385022f2dabc484',
	},
	deterministic: {
		securityPoolDeployer: '0xf2cbefaee1e298938509dfab928d230a7656a0c994efa4bdc4c662ff2e10043a',
		securityPoolDeploymentWorker: '0x18f0f8acaaba9a0f35830c11120c2de5363d34bcaf43a3a1305b4d054cb9c7bf',
	},
	mainnet: {
		securityPoolDeployer: '0xa5fc3698249ace10de66855ec7716aeb38ad4dfc47b5ab2cfeb644f04c8b7e15',
		securityPoolDeploymentWorker: '0x43ce77b979f69fb06afaebf8e5aef4198ac2d7b06956e68ee3841a13de080940',
	},
}
