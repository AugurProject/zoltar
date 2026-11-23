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
	escalationGameCreationCodePartOne: '0x9ce8bbbbb58322c517113486ffda6c8284009b056162d94d4884389716298dea',
	escalationGameCreationCodePartTwo: '0x10145f21db700f5ff094978a8a052d22b05b4fce18411596e0a68e642de3b8ac',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x9b15366af2f5f73eadb261dc037082e3d1e0b7ba293cf92498cc1579024c0809',
	priceCoordinatorCreationCodeSecondChunk: '0xc2b31bdf6480d9d297ed73ae8eadca6724d8ab0f7ed5a8b15d641d4f6979b984',
	securityPoolAuctionCreationCodeFirstChunk: '0x47d9fa8acd196d5d9fc471e20d6f2b6a3c619eebe5b1c0c0491712213e858673',
	securityPoolAuctionCreationCodeSecondChunk: '0xd5a7fc6106d229f78f6618850e5cdbe012bafd48134b2580e71c04858cc3457a',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x17405dd804066a7520d0434d8a5979ca252b805f9a6e36ade857296498108e45',
	securityPoolCapitalCreationCodeSecondChunk: '0x86d85f9c9e643487497ac97c2347ddae77847dc805b9d795776514bd21d001e8',
	securityPoolCreationCodeFirstChunk: '0x8efd1f85a6788769b72b3c45aca4d527b5e5c4e83c0bdd5126032735b630607c',
	securityPoolCreationCodeSecondChunk: '0xb6742714ec4a3509af11d8f81f63903e7fa774f277e6d994fe81fef300818c84',
	securityPoolForkCreationCodeFirstChunk: '0x544fd4541944bda324764167f9f42a7303169a7bdde8636cec2de1c0d11085fb',
	securityPoolForkCreationCodeSecondChunk: '0x88df96a29690b05009fcbda1d32e9b85618bae99a720e514009dc0c43402b531',
	securityPoolServicesCreationCodeFirstChunk: '0x41c9c934fb9c8c7e2e298052060021d9e8ca3b06eadc6c1f0e52edf4acbdb0ca',
	securityPoolServicesCreationCodeSecondChunk: '0x9ed519bd621f709bf32fd20f42b9b2c737ec7362dd236089df96ca87370da694',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x0d760662116e917c0ecce26161a3f3d7e769d23ab3f234a97b82d81673ffb4d7',
	securityPoolSettlementBookCreationCodeSecondChunk: '0xd9ea5fa2566e7d8bc577c4604f83a68d9b814f11fc6f16f873d9809a136954d2',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x40315b6aaa941ad5656f153c8ecb8b4d3c9ce34041b6c272762ee28c99adc607',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x5e779364dcfea137c3e824dfa619a6295ae539cddbf5656cc6490fbd6c62b72e',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0xc4dc72a9dcd9ecd48313595a6651244ee036355bc48aacd886dbdf67416a7aba',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x349cda16546dc3a23c220b17725567193c6e117b53ff506d8827109b38fd0a91',
		securityPoolDeploymentWorker: '0x86c32072166fe10606cb0f6bb159cbf37a06ea57ad189af1a9baf04810bd1c0d',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x6712a74ca1440e09cd2f17370f975dcc13e07eeb0653b87d736c03109d85d219',
		securityPoolDeploymentWorker: '0x3baea458d816e147959f85358eeaa051774c1b5d99679dcfca955d06bc8c9048',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x9d3ac6a68cde89f24c2745686e403d312d36235babdf39dc35df00b67d6019f7',
		securityPoolDeploymentWorker: '0x8da490506edd59e0b24dbc9aa317827228519bc0fad161b6a6baeb903c2add07',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xc72492c58a44fcb83a3a8091b4ef37f99fa02e72d4200015fc3e9c9f7f8f4e34',
		securityPoolDeploymentWorker: '0x959c429230f7f13568935cadabc27996e391e96a67d91979a487ae0bda276f58',
	},
	deterministic: {
		securityPoolDeployer: '0x90ec564723d274f210f8b4edf356b6ebc000c8193cb979bf67cde94e3470090d',
		securityPoolDeploymentWorker: '0x59bd67b049a5c693041930a2b1c2b06fc8881f9589be9e61e578a911a5532b88',
	},
	mainnet: {
		securityPoolDeployer: '0x2b1e54434b9555855e7cf16b61d6f3c5668d8935a7ecea187a409c5e0b3364f2',
		securityPoolDeploymentWorker: '0x0dfcfbdc36c1404ca5ff4cbb72a7158007d753f3f0c123bed6ff3a3fa64c8d3c',
	},
}
