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
	escalationGameCreationCodePartOne: '0x0007cdbe740fc4b9b70dc2fc709560f9a634da2f772bd00df0fccc6fc71b59e2',
	escalationGameCreationCodePartTwo: '0x66c7452003652e726589f4077a8a9b841c80c7b1d78686e372c7437d6f228dcb',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x9b15366af2f5f73eadb261dc037082e3d1e0b7ba293cf92498cc1579024c0809',
	priceCoordinatorCreationCodeSecondChunk: '0xc2b31bdf6480d9d297ed73ae8eadca6724d8ab0f7ed5a8b15d641d4f6979b984',
	securityPoolAuctionCreationCodeFirstChunk: '0x47d9fa8acd196d5d9fc471e20d6f2b6a3c619eebe5b1c0c0491712213e858673',
	securityPoolAuctionCreationCodeSecondChunk: '0xd5a7fc6106d229f78f6618850e5cdbe012bafd48134b2580e71c04858cc3457a',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x6b9dfaf589800052661ace577daf2ac7e7bb2343edcbacc57bc8c8c8c74d766a',
	securityPoolCapitalCreationCodeSecondChunk: '0xa72f84ae7410e9df3c92f8ed5a29c6081156c5b20d4a1093abf5bb8a8335627b',
	securityPoolCreationCodeFirstChunk: '0x8efd1f85a6788769b72b3c45aca4d527b5e5c4e83c0bdd5126032735b630607c',
	securityPoolCreationCodeSecondChunk: '0xb6742714ec4a3509af11d8f81f63903e7fa774f277e6d994fe81fef300818c84',
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
		securityPoolDeployer: '0x8a05f2e1eac902f9ad9f6ef82afe84d4ec94597dec3f955b7a47d0d19b5bf79f',
		securityPoolDeploymentWorker: '0x69948fe2d649022717cfce34f03ee17a1c6510232f95f3ba2b4e5199e5e2d593',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x7be228ce5b3b6762465fe69c271d31efe53a185925a6e9415ebe95edf58a54db',
		securityPoolDeploymentWorker: '0xb67c5b7693b30623393a0edf237c5693dabe858cb9aa9c5493f42d948a40c881',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x9cfd14267ee0556db3d33321a28eac484676877db0f66ae207b330ff5e881671',
		securityPoolDeploymentWorker: '0x3908a86c6ada790884a2443c4bc6bf58c6a0fc7f47f0d098c70a21fc77fe5cf9',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xd13e2167e7573deb82ad9a6ff088416bee70ae21f893467649ebbbef5f619085',
		securityPoolDeploymentWorker: '0x9e93e557f47d54bdc7a44986c5a6679a8daaa7fded1d173300300f2766a4d656',
	},
	deterministic: {
		securityPoolDeployer: '0xcc54787a81a350f9063deaf3cbeece9cd64eb6501b46627056b039cd89fab9b9',
		securityPoolDeploymentWorker: '0x86640a8b6bd972d8bdf1de637e7bddc719eb1e2bd9365fad3c87db03826dd319',
	},
	mainnet: {
		securityPoolDeployer: '0xe3603f6768f45da4029238767d5a5a25acd42baaa06ff755f5f56e01f38075a3',
		securityPoolDeploymentWorker: '0xa05e349815489583b5e4d6886675941fb607e4b17503fa32b0df91c840d658c0',
	},
}
