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
	securityPoolSettlementBookCreationCodeFirstChunk: '0x8b3c385d9cbb46dd524f506df75bf430a32cefb715eed4c14fe69598fd7d27dd',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x20333e561f682fc145ae185361daa1e91dc0543386c024000e1e637e4ff45f4b',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x253d40a26406943fe8e8be99681866a842d114a7b9c9bbd69ef789c94362d8dc',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xf933c10391e3508d350fe2b78c9cad8d6c40a4971deba5605233077e1ef65b58',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0xc2e834de06217b34b9c9bc8173d23c0d769355873e80694c273cfac71fbc1345',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x341b848b86e6f60aecbf8120b34d598c7818ded04f59bc98ccfc33770bbe6a9d',
		securityPoolDeploymentWorker: '0x8515af04ec58fc72774a7299b20e3da6528c40bf2788f6adb4120b57e054716a',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x6218af246aa76ec101f5d9ff8f3b746ee898a24650f25c2ddccbeb8064b0da45',
		securityPoolDeploymentWorker: '0xbd95536936c87cb4b7d9ed1df330275a1c07b0fdb548499af793fa67cfc2a448',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xe90c1d327de3a578642d53b7b0bf93b58b755214a3cf5f56f3db724ddd3cad99',
		securityPoolDeploymentWorker: '0xf7732881bea4aeac1a908c944532b58d934e95623de2009143a6b84d309f3925',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x37032c57e50d03e6f9ad7944f0187ef7d26674d84cbc8ca520f60a2f9e58bde7',
		securityPoolDeploymentWorker: '0x1a88cf86e79523fece221eac1005807ee3f3fdc205669a7eaaa8e2f5ca9713b1',
	},
	deterministic: {
		securityPoolDeployer: '0xddb4c33667418489a9447f6e17c29905dc2e8aef860781a439cf334deb82fbcc',
		securityPoolDeploymentWorker: '0x61d564c06269556054d3ffee9641dd4ca895c1759939b3926b28da8c44b72a1f',
	},
	mainnet: {
		securityPoolDeployer: '0xb42e334d6db6e35f6648e880230afcc8430e70b4fb9d4d0ec99fb002309fedcc',
		securityPoolDeploymentWorker: '0x0b044d0b60fa37b6bd739e62068b8bbfdb542eb85d4f286fdbb14646c67cccd8',
	},
}
