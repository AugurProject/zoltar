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
	escalationGameCreationCodePartOne: '0xd4e3bfd8a0dacd5d4109bbd67b51fbede200a0cb3170931c0061e68fe16a21fa',
	escalationGameCreationCodePartTwo: '0x075a716a701c41dd96607e23e59085592c2dcf73c1a9c33384e327165154a97a',
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
	securityPoolForkCreationCodeFirstChunk: '0x544fd4541944bda324764167f9f42a7303169a7bdde8636cec2de1c0d11085fb',
	securityPoolForkCreationCodeSecondChunk: '0x88df96a29690b05009fcbda1d32e9b85618bae99a720e514009dc0c43402b531',
	securityPoolServicesCreationCodeFirstChunk: '0x41c9c934fb9c8c7e2e298052060021d9e8ca3b06eadc6c1f0e52edf4acbdb0ca',
	securityPoolServicesCreationCodeSecondChunk: '0x9ed519bd621f709bf32fd20f42b9b2c737ec7362dd236089df96ca87370da694',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x0d15ad7ffdd68e196ce13bbc5e2e25b4d9c0a1b1a54b8bab60e478fbb6c961c7',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x6f6a3f77e05696d6760e20c7013acfd144ebbe39178ddaacff5f858349b87f45',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x253d40a26406943fe8e8be99681866a842d114a7b9c9bbd69ef789c94362d8dc',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xf933c10391e3508d350fe2b78c9cad8d6c40a4971deba5605233077e1ef65b58',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0xc2e834de06217b34b9c9bc8173d23c0d769355873e80694c273cfac71fbc1345',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xeaec3f1cedab6fff88246e4d0e7b9c7cb4444b0c89034e5556385b0ed8b0559e',
		securityPoolDeploymentWorker: '0xa19305894083f7c5010a17bac3f03a7a0c8d26fc223226bb0616da254a11d469',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x0a3cf77c6b12c735eb0fdb2dfb909b773515cd7b768417c6f776d7478890513c',
		securityPoolDeploymentWorker: '0x283843ec0c63aee45aa657700aa9f8153598e09591ac8286a5ad6b0a9e642298',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xef7a4d9f406940b54f850c303027f3be3dc1d9cbbd004dc92e6c771899a514dc',
		securityPoolDeploymentWorker: '0xf6cfa275052dd3713805fd6543c60184571b93101bf517aa94107665fb96d566',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x2d838cf7cebf9cb989d08a1df6b2d7d35a285367f067d092db93c5e7599dcd22',
		securityPoolDeploymentWorker: '0x72d2d84a56f19bfd928d1fc296c7484a1ffbb932b7868a74eaf08333b6777b11',
	},
	deterministic: {
		securityPoolDeployer: '0xf64de09acb6027de738973e302a0c2d5277db20f1f92dea8a06284fec8a9b824',
		securityPoolDeploymentWorker: '0x031a0ac84b40a43cccad89d67dc70d1c2bacccb845a9f5aba47007f59dc7c4d6',
	},
	mainnet: {
		securityPoolDeployer: '0xf58a48b8f502d8a5237856d7790227fb5ed33b4636df0eb125c4f9416718683f',
		securityPoolDeploymentWorker: '0x9f61019036eb0305940b76ab6da0a3aba428710908157000a5ee1fd3b5a465b0',
	},
}
