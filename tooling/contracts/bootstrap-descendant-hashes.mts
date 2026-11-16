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
	escalationGameCreationCodePartOne: '0x751b397bda35e9cbb1d566bfe152c8fff349d50148c2f83693e983fb082ac8ed',
	escalationGameCreationCodePartTwo: '0xda0f685a17b91fe41c94234c902cfcbea8bbc48b914346a43a016d0fcb641dd6',
	escalationGameProofVerifier: '0xae36c0b208871ec2ab53bbcac4fd1ca7d2c39e1a406889adcd12545127b0d2a3',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0x87c68ce4be02c1314cc2a3c96d4695e5dad0f3db7ae14a73849cacbe5b31d3a6',
	securityPoolAuctionCreationCodeSecondChunk: '0xa7f49f45e915eb19883fa960924d7a1c05eebb9f5a3e2528289c35535da53e32',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x7c8ec28a6693042a8926610b4c881cd3061aaf6509908e5d7943fe10266bba52',
	securityPoolCapitalCreationCodeSecondChunk: '0x9103e96bdd650d00065a5ba80ac3f18ec1e69c0df49163dea3922a787ee09667',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0x24e14e35307cf8a58e781bb11bc122da9f030411710396e8aaac1925f1606c2d',
	securityPoolForkCreationCodeSecondChunk: '0x0596df0ea535727c1994cd09d5d50afc690f175a06ad7a0178edc0e749613ce7',
	securityPoolServicesCreationCodeFirstChunk: '0x371e8597095a8ecb960a2a782a640c210945c15604cccaba74bd2ea98b804d74',
	securityPoolServicesCreationCodeSecondChunk: '0x585dedf4cb5de39e1288ff755671dcb53942117dc99b3de2d7734ac0fc33b151',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x2e565462c2a57ee4aa914554302a4d31b221ded3528629ce04b95b76d59cdbeb',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x1036a565aa5e1c14af2c309b7338ace43e83e692ba00e3c46220094588e1075d',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x3c2b5e566e3a4b5a8500c5c55567d0450a2905e1ef855fb0b23f1b80a8f14fe4',
		securityPoolDeploymentWorker: '0x715feb5ec4a3f8f3c1edb1ea5282c1ffdd5fc74ef1198b79e5a82970799f566d',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x59d848db483268dbed29af3a0d0d5428cc0af2692b75c3b805fe823030e67e1c',
		securityPoolDeploymentWorker: '0xeb90f5b05178ed4ef1943af31f3ccf73c528b4d6397d1387987743b5ede24c69',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x2f697b5ca58fe5700d58edcd42d77e12d42be3d8920a60940b2f4e52d3fc0c8b',
		securityPoolDeploymentWorker: '0xf48e48b405e6bec777d0853a4baae37cbfc50670c936695c46f62af1aa9508ec',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xbfe04742b436066359fa2b88d22212f5f94474e175b16c4bbbfc11adf7cc0830',
		securityPoolDeploymentWorker: '0x4ca5b533de182088831327d5ce3fbb657aa4619dbac21e72d383fcc84872a1fc',
	},
	deterministic: {
		securityPoolDeployer: '0x560cbc896c157c1a944226b7f8ece3f6e9f0dc80669923679d0ac51560eb3b00',
		securityPoolDeploymentWorker: '0x3838acee3fa5733123183c0cf11bbac962aa69f4e02148039318677ded2e0f97',
	},
	mainnet: {
		securityPoolDeployer: '0x379aa15030aa376efb5e8acf09681ca03179d8c926ecb0592993a5e36bab7aa9',
		securityPoolDeploymentWorker: '0x795505738a6cfa37bb394e8aa09239234456f18638f07cfb74085080f207408d',
	},
}
