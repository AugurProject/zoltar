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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x0091a096cee18caeda8e998b027a99327eb9545b6f99fc1126c724193af760f7',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x1482078198c581c5527a66dcf2a373d5ebf53ae4212960c0a04d0567649f4514',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0xc2e834de06217b34b9c9bc8173d23c0d769355873e80694c273cfac71fbc1345',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x92bc42d2cd973a2c53d551c0e826ed347ec293382a6b195f2688c430ee7890bc',
		securityPoolDeploymentWorker: '0xec92db761d6e127cd8850e862057f3ea45113b52bfb546e42fb3311f31aa9c97',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xbb530a2baacd1c0d44da8cf7915978dd88b16350a02b05e3a2f02dd69fbbfd51',
		securityPoolDeploymentWorker: '0x29fbfe6969fc370186604399adde6c2ead698327d330edc320c774aaae83f48b',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x11f44094b5b71d68509a39f9e3f990c1a7372fdcd6ec37c5c8f138675fa7f8e7',
		securityPoolDeploymentWorker: '0x528afe1c73cd08f98751c201e40c0e9c666167ab5f88c49799bfe9e0f3f9bf7c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x156b948f52c2f4a014222c11a7faf951ad893955af38eac20da7b8b5680be517',
		securityPoolDeploymentWorker: '0x814d9f4f7a52ded2a54468eea70caa9e1777894848e55a7565576008f546eea2',
	},
	deterministic: {
		securityPoolDeployer: '0x2fceeb85880d3d0c7d5781a6980ec77432e10a0559d4f4704043924142a2604d',
		securityPoolDeploymentWorker: '0x5498f292494d8cffa68e381a692d7609292b5a85f8a951a618bf8cca7f4fd3b6',
	},
	mainnet: {
		securityPoolDeployer: '0x9a7a83d769ab0fd42e21107ee6fb72398f687082599ac3671af3fbde22e3c80b',
		securityPoolDeploymentWorker: '0x8c63e0a0ebfda9447eae0cbc93efb1ec4bfa13fb445b12c8d6a9c564001d2112',
	},
}
