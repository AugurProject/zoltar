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
	securityPoolCommitmentIndexImplementation: '0x006f7debfcdea555ad3538246f9d4021e5ac38e5f8758719ddafc6d26efe91ec',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x5dcdee9202989805e8ed4a023af720056a853322341778a0d2769f5c2bee49fd',
		securityPoolDeploymentWorker: '0x8078d1908acd981e59f3a59bef2c6265d5b62c4b7298cada0436bff1faf3bf30',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc3077199b06a6b8b82c3e0349d1d24466656d01b302e91865ad227932bc92f87',
		securityPoolDeploymentWorker: '0xad650965c8ed721270c31df8be66052c7a4ec3c11b7eff4f0a7912dc55d26bfa',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x352aa54f29ad0ce39865d8f119c38640085572300ac6aa9edb0a84e83063046c',
		securityPoolDeploymentWorker: '0x3e9f63b9e1d946c6edc29db403852a9f7d5034e376a401015a6fce856a4cc0cf',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x9b78dde6acdfc32f497867019dcec2239e5b24dc381874a2afebd8072f644568',
		securityPoolDeploymentWorker: '0xa3244624367148c5c517cf641847c4bc5c13ce97a7cd4df5aeccb640f622f638',
	},
	deterministic: {
		securityPoolDeployer: '0x6c21311bef8c4c1a15b2f8cbc96faf79d994da1acec8557f0ab483974a668e08',
		securityPoolDeploymentWorker: '0x35ecf99dd738e3088643025d6cef2ae09256afa6e1f08e71eb48db1b209f9465',
	},
	mainnet: {
		securityPoolDeployer: '0x23fe1d395d9d4a923c268b9da0cf55807df1cb04804767847c2bda51f7c36f30',
		securityPoolDeploymentWorker: '0xd1b0074defd4b56b446d6c2a5cd9c625949ac5d445b0c7cc928ed6877bc183e0',
	},
}
