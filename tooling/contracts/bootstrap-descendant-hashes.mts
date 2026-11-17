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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xe104805d8838b753aacec6934df4c9bac73eeb68f175ac795bef0e8bb94199c4',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x18cd41270477f1435ed735be7c1c5dbf0a6cd47483e85e150c2d9b9c39d86453',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x7d9258b37531cb496ba4da247bc31baaa299c54ed5ceb7316271b7959dbc9527',
		securityPoolDeploymentWorker: '0x37bff2365a796afd8e5586758d03ba8b8695537fec37b60851ed685d41f0588e',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xb535ebbec97615413bbd6f7dae9b67ea0be6946f7647455bf0b4c32bedcf9425',
		securityPoolDeploymentWorker: '0x111cbdead6a57321c3da6dacbb03e9630a009e0bcb49eabc759c6e101850612b',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x2524e13bee7e46a90fff6874d9487f4d419f544170393c70fccb1c405ffdd661',
		securityPoolDeploymentWorker: '0x8be99ba4665fa045ada010056a5d42d50830bee4af608422eb8287e0ba93f58e',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xdaf0a5ebc571015f7e1dd24b184f5124132c6da364aa3e2816fc23d626fae818',
		securityPoolDeploymentWorker: '0xa8bb3e2228ff7502b61b718be05bdb0ead586f90d07f550f03115641d718c6ce',
	},
	deterministic: {
		securityPoolDeployer: '0x90945c1e0a72f56ec7161e7d1677cbfa0a0b5989fcbd3b7b55b141a816503274',
		securityPoolDeploymentWorker: '0xa2d0c4575254c17651ca8a05c0db37260e12d3e78c532bb2f615e63371d1ad63',
	},
	mainnet: {
		securityPoolDeployer: '0x4d7749a72c5e1f2c5b84310f0f23c6026acedaaccc089d45b39150bd081fba49',
		securityPoolDeploymentWorker: '0xe4d40feae00198bb12f63b20cfb222e3d44427268eb442a33d13fbff36c767d8',
	},
}
