// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGameStorage } from './EscalationGameStorage.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface IEscalationClaimGameContext {
	function securityPool() external view returns (address);
}

interface IEscalationClaimCheckpointSource {
	function applyInheritedClaimRetention(uint256 amountAttoRep, uint256 parentDepositIndex) external view returns (uint256);
	function rootClaimSourceGame() external view returns (address);
}

// Descendants inherit only the aggregate carry commitment installed by
// EscalationGameCarry and this retention checkpoint. Individual claims remain
// identified by their committed depositor leaf and are never copied or moved.
contract EscalationGameClaimDelegate is EscalationGameStorage {
	function rootClaimSourceGame() external view returns (address) {
		return forkCarryRootClaimSourceGame == address(0x0) ? address(this) : forkCarryRootClaimSourceGame;
	}

	function applyInheritedClaimRetention(uint256 amountAttoRep, uint256 parentDepositIndex) external view returns (uint256) {
		address encodedSourceGame = address(uint160(parentDepositIndex >> 96));
		address sourceGame = encodedSourceGame == address(0x0) ? forkCarryRootClaimSourceGame : encodedSourceGame;
		if (sourceGame == address(0x0) || sourceGame == address(this)) return amountAttoRep;
		(bool mantissaSuccess, bytes memory mantissaData) = sourceGame.staticcall(abi.encodeWithSignature('cumulativeClaimRetention()'));
		(bool exponentSuccess, bytes memory exponentData) = sourceGame.staticcall(abi.encodeWithSignature('cumulativeClaimRetentionExponent()'));
		require(mantissaSuccess && mantissaData.length == 32, 'Claim retention source');
		require(exponentSuccess && exponentData.length == 32, 'Claim retention exponent');
		uint256 sourceMantissa = abi.decode(mantissaData, (uint256));
		uint256 sourceExponent = abi.decode(exponentData, (uint256));
		require(cumulativeClaimRetentionExponent > sourceExponent || (cumulativeClaimRetentionExponent == sourceExponent && cumulativeClaimRetention <= sourceMantissa), 'Claim retention order');
		uint256 retained = Math.mulDiv(amountAttoRep, cumulativeClaimRetention, sourceMantissa);
		uint256 exponentDifference = cumulativeClaimRetentionExponent - sourceExponent;
		return exponentDifference >= 256 ? 0 : retained >> exponentDifference;
	}

	function applyInheritedSourceStorageBasis(uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 parentDepositIndex) external view returns (uint256) {
		address sourceGame = forkCarrySourceGame;
		if (sourceGame == address(0x0)) return amountAttoRep;
		require(cumulativeAmountAttoRep >= amountAttoRep, 'Carry cumulative low');
		uint256 retainedCumulativeAmountAttoRep = IEscalationClaimCheckpointSource(sourceGame).applyInheritedClaimRetention(cumulativeAmountAttoRep, parentDepositIndex);
		uint256 retainedPreviousAmountAttoRep = IEscalationClaimCheckpointSource(sourceGame).applyInheritedClaimRetention(cumulativeAmountAttoRep - amountAttoRep, parentDepositIndex);
		require(retainedCumulativeAmountAttoRep >= retainedPreviousAmountAttoRep, 'Carry retention order');
		return retainedCumulativeAmountAttoRep - retainedPreviousAmountAttoRep;
	}

	function initializeForkClaimCheckpoint(address sourceGame) external {
		require(msg.sender == IEscalationClaimGameContext(address(this)).securityPool(), 'Only pool');
		require(sourceGame == forkCarrySourceGame, 'Claim source');
		require(truthAuctionRepBeforeAttoRep == 0, 'Haircut applied');
		address rootSource = IEscalationClaimCheckpointSource(sourceGame).rootClaimSourceGame();
		forkCarryRootClaimSourceGame = rootSource == address(0x0) ? sourceGame : rootSource;
		(bool retentionSuccess, bytes memory retentionData) = sourceGame.staticcall(abi.encodeWithSignature('cumulativeClaimRetention()'));
		(bool exponentSuccess, bytes memory exponentData) = sourceGame.staticcall(abi.encodeWithSignature('cumulativeClaimRetentionExponent()'));
		require(retentionSuccess && retentionData.length == 32, 'Claim retention source');
		require(exponentSuccess && exponentData.length == 32, 'Claim retention exponent');
		cumulativeClaimRetention = abi.decode(retentionData, (uint256));
		cumulativeClaimRetentionExponent = abi.decode(exponentData, (uint256));
	}
}
