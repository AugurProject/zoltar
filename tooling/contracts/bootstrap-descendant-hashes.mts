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
	securityPoolSettlementBookCreationCodeFirstChunk: '0x8903ae3fb778f64f52cd9fb0de21ad48750589a306a7bbecb226249cb329ae0d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x08d55607462bc937a3228a07ab4a4c8294403476e31187a00d5473ef343a7d51',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x40315b6aaa941ad5656f153c8ecb8b4d3c9ce34041b6c272762ee28c99adc607',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x5e779364dcfea137c3e824dfa619a6295ae539cddbf5656cc6490fbd6c62b72e',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0x006f7debfcdea555ad3538246f9d4021e5ac38e5f8758719ddafc6d26efe91ec',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xd225b0bff4aede8278a52da2b0d77e22e9d6286f6c9adbe2a9647d7f548fa854',
		securityPoolDeploymentWorker: '0xbd3a23346c4beaf90291fd32f672cefd04b8b1ea2b94af713b90e2f34597693d',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xbae7dac3f4895598ed3878e1a168df05874d24800f7e08f10caca9ee0e0bf4bb',
		securityPoolDeploymentWorker: '0x01322f5ade9528f60ff6666212b5da5c322b782db4133079d5caf5e8fd4c3842',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xdbbc0418b95c52dd2a71e4fd06a52b731567d20dd2a64a187fa9bdd3b7594110',
		securityPoolDeploymentWorker: '0x31e722b2eb8fbd93143e8432070d05e61d83d427d1f16860b386606b8a769644',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x28f7fbb4b1934c90b0607511050078b4ac4f74095cce4f4189df9ca23bbfc139',
		securityPoolDeploymentWorker: '0xc951b4bbde6fcb76fd63ca6c2c1915e743bfb560d7503cb708df3ee848ad9237',
	},
	deterministic: {
		securityPoolDeployer: '0x2e95b31642d973e9cfa66b91251f85cb5c132a821cd2d928ccd8b91ba3525dc9',
		securityPoolDeploymentWorker: '0x42ffe8be4d1ab17902b1eeb091c7442ad7f91365991451e776afa8ab745ce00a',
	},
	mainnet: {
		securityPoolDeployer: '0xf9192706eab673b3d578e057257bafae21ff8b00b7b9df82f8f96b83ee3d9be8',
		securityPoolDeploymentWorker: '0x0bc2189194c5ea2f60cf0362891cf307994356f5b348f7dcab926f49a2ba6c5d',
	},
}
