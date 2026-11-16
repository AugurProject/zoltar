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
	escalationGameCreationCodePartOne: '0x47b7df45744196388360a847f5bae40b39c25ceeea5af62f009ffb59b5c86cd3',
	escalationGameCreationCodePartTwo: '0x4353b6da3ced3961cfdfb922ca5498413b337e55bfa8341d5e31d4b38d8f0697',
	escalationGameProofVerifier: '0xae36c0b208871ec2ab53bbcac4fd1ca7d2c39e1a406889adcd12545127b0d2a3',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0xa4d131b6fd2dc31538ca28ee1f9fe758442b771fa8696331e5c76e5f2dd95748',
	securityPoolAuctionCreationCodeSecondChunk: '0xbb3d5959b2440cf48be49bdbb280db2538e364ddfc6fca38aa4125abc17c555c',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x6c341c710e50657b8800e482a61b9d2a471fbb54c988cd1db3360521dd1c7f65',
	securityPoolCapitalCreationCodeSecondChunk: '0x55697369084e2f8d6cddbc050ec243e28faaf2371abf3023563ca505ed7c2968',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0x24e14e35307cf8a58e781bb11bc122da9f030411710396e8aaac1925f1606c2d',
	securityPoolForkCreationCodeSecondChunk: '0x0596df0ea535727c1994cd09d5d50afc690f175a06ad7a0178edc0e749613ce7',
	securityPoolServicesCreationCodeFirstChunk: '0x55a33d73b9f42e4d6f703c077213edf4abad4c6ebe1416933b213cdb28539851',
	securityPoolServicesCreationCodeSecondChunk: '0x800f8c538ff1d99ffa134d806226a8a902f74f890edf08b411c0c0307b89309c',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x4b7f917f29579365b68d9694e306170f26471f15f190726952bd9ce9dd21a967',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xfb43ef5f9b1dbcf433c8ca859fa67f4150f4499fa6dc8229e788dacc4466fc76',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x54a66f9a8d68dc577074fc1c02080c63d25ab5c8a1628ac7cd1ea0790a8e694b',
		securityPoolDeploymentWorker: '0x3282bc06ce284a9ed95b10dd287d605943f528f9d11253af148e2f9276ff3a66',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x821e470915d7d4441100c179ca6a6cfca11269f5e3588b56c3c43ed9b59ef8f7',
		securityPoolDeploymentWorker: '0xb56b92cda8c5258f4af7e1543f321c69128256b901d871648245e23e7af19409',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xdc28343ac619de7e0ba705b47e8fc28df8083bd7a7d6073e13da58eaea17ee84',
		securityPoolDeploymentWorker: '0x34bb2c885877edac6fde729a7b67db62178bf7655f4df853f8bb8aadb1ed9481',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x5c107af77fb5273be946d322269dfd61d00464dcf5cf202c8935aef46caa7f05',
		securityPoolDeploymentWorker: '0x4d6f6aa6b8f5af7bfc05ff2aa1016f4b5ecbfcebc51227dd4147b0af14ce2169',
	},
	deterministic: {
		securityPoolDeployer: '0xa2777bd94f843851991e1b70e000d970c31ea9a63b093a669d5869aabadf66fd',
		securityPoolDeploymentWorker: '0x996c7c50af3ff69deb47c4b6352797bc424b7b60927dbae4f7c90985a62c6bc2',
	},
	mainnet: {
		securityPoolDeployer: '0x993972d950db8605575edb6951d9dccb870babb93a047522d0da3877b423b255',
		securityPoolDeploymentWorker: '0xbd434ac6257b8b58c491115331fd20580b8b687a3681609d9f62bcd67bfab640',
	},
}
