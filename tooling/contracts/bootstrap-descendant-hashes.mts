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
		securityPoolDeployer: '0x20546fe807e970c5da90b813a2e41e0f3edf9842c2e8b099b416c4d4953b8f76',
		securityPoolDeploymentWorker: '0xbb5a3310840d6e644602377093eab68f8a1b0b9be8fa3e4389b8c4098b273d01',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xa90687e4ce4f59666fcffec7d91c9e6f2bfa10dfaf0f413352baa6ccf04623b6',
		securityPoolDeploymentWorker: '0xfc0245cff51b53cd2d1d4817a93c21db0a28c69d7adaab0b6346970e27c71c89',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x7e04f6eb1ac7906540b972a692835a304bd9e950a0397dcae60d62c964cfac37',
		securityPoolDeploymentWorker: '0x2f05adbc0545f214f7c1ac7c9355dae26b427bd49a46d2f5623feaf0f2d93583',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xce858b9f9f72d5278c00dda02cf9a2448af0abd3da1e32560b418d15eb0c6797',
		securityPoolDeploymentWorker: '0x9901c5336fddac5246cafba7c43ab7e51a1ad147815ae9c8d31202dbbd1bb571',
	},
	deterministic: {
		securityPoolDeployer: '0x50753c85c5c12ad4d88a1477d0a324a57385050642e2058d4713709b435288ee',
		securityPoolDeploymentWorker: '0x80880e49b18c0dd95b95707aa967f62cef194cf2055791072180c0729692b14c',
	},
	mainnet: {
		securityPoolDeployer: '0xead45dd0d89e7a8871e4fbfb3a09740f2d1ae744715d4ad2854e21f80a500ad7',
		securityPoolDeploymentWorker: '0x5cb638cd650f393672587daabdc5323a227f2521dd334a560c2f4e0af9ba7c08',
	},
}
