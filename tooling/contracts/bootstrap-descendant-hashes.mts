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
	securityPoolSettlementBookCreationCodeFirstChunk: '0x7dcdb51baef87db487d857ede885b38ade31b625e805a8fe2d2889d0b4bd2658',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x3752767177f950bc9066e78f6132e84cc933c1cd77d56b3208ad0ec389b278f8',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x40315b6aaa941ad5656f153c8ecb8b4d3c9ce34041b6c272762ee28c99adc607',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x5e779364dcfea137c3e824dfa619a6295ae539cddbf5656cc6490fbd6c62b72e',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0xc2e834de06217b34b9c9bc8173d23c0d769355873e80694c273cfac71fbc1345',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xa0820b5c8fbe974006195d26133d9c0cc168fa628bc73dde085a5d3ac5b94a5e',
		securityPoolDeploymentWorker: '0x8dbf4eb0f021e6c3bb1cc9df459f6976abb8373ef0b8887dd2d605fca4c36bc3',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x80f4ac590f915e1a755c044e0ffcf3b1fded6ad723e23ed9cbe295bf343aa7a3',
		securityPoolDeploymentWorker: '0xde063f3e2539f6850d855917686e78a60adf0cd5f088ef7bb7d7508d8e799a7c',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x925787ba3345a2c84e1590a702c48a7fd0c06087709253ace3f7a9776580f142',
		securityPoolDeploymentWorker: '0x10468c327e06b4bf6d1038dd81e212e799371ac685c931b4f277dd2d93cff22b',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xcaf59c1e3ee31d7c72840a4babffa9549c04d5fc878530eb70cba9c70390dfd1',
		securityPoolDeploymentWorker: '0xa26e8728e21995cb37e0ee3be75947bb00fca583d01e57fca813551f5198ad48',
	},
	deterministic: {
		securityPoolDeployer: '0x392518a42a33c45b548ae8763ef54eeb5909a5b8dc1cb81fdd147da62b391039',
		securityPoolDeploymentWorker: '0x06c8a09f221478efda70cfebe8573ca7bcad5968cb1e20464838059b38a98724',
	},
	mainnet: {
		securityPoolDeployer: '0xd51cbd685f5ed184a49588009ca7e6bb57b32697a38fc1234a9e064dbd666be5',
		securityPoolDeploymentWorker: '0xb8378058ef13e23d85e7a1229455ac7c606cc7cfa8f9b51a13cd4fa79edc4da7',
	},
}
