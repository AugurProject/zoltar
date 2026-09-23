// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGameStorage } from './EscalationGameStorage.sol';

interface IEscalationClaimGameContext {
	function securityPool() external view returns (address);
}

interface IEscalationClaimCheckpointSource {
	function getUnresolvedClaimInterval(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) external view returns (uint256, uint256, uint256, uint256);
	function rootClaimSourceGame() external view returns (address);
}

// Descendants inherit only the aggregate carry commitment installed by
// EscalationGameCarry and this retention checkpoint. Individual claims remain
// identified by their committed depositor leaf and are never copied or moved.
contract EscalationGameClaimDelegate is EscalationGameStorage {
	function rootClaimSourceGame() external view returns (address) {
		return forkCarryRootClaimSourceGame == address(0x0) ? address(this) : forkCarryRootClaimSourceGame;
	}

	function getInheritedClaimAllocation(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex)
		external
		view
		returns (
			uint256 sourceAmountAttoRep,
			uint256 retainedAmountAttoRep,
			uint256 rewardAmountAttoRep,
			uint256 retainedCumulativeAttoRep
		)
	{
		(
			uint256 startAttoRep,
			uint256 endAttoRep,
			uint256 rewardStartAttoRep,
			uint256 rewardEndAttoRep
		) = _sourceClaimInterval(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		sourceAmountAttoRep = endAttoRep - startAttoRep;
		retainedAmountAttoRep = _applyTruthAuctionRetention(endAttoRep) - _applyTruthAuctionRetention(startAttoRep);
		retainedCumulativeAttoRep = _applyTruthAuctionRetention(rewardEndAttoRep);
		rewardAmountAttoRep = retainedCumulativeAttoRep - _applyTruthAuctionRetention(rewardStartAttoRep);
	}

	function getUnresolvedClaimInterval(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex)
		external
		view
		returns (uint256 startAttoRep, uint256 endAttoRep, uint256 rewardStartAttoRep, uint256 rewardEndAttoRep)
	{
		(startAttoRep, endAttoRep, rewardStartAttoRep, rewardEndAttoRep) = _sourceClaimInterval(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		if (leafIndex < outcomeState[outcomeIndex].snapshotLeafCount) {
			startAttoRep = _applyTruthAuctionRetention(startAttoRep);
			endAttoRep = _applyTruthAuctionRetention(endAttoRep);
			rewardStartAttoRep = _applyTruthAuctionRetention(rewardStartAttoRep);
			rewardEndAttoRep = _applyTruthAuctionRetention(rewardEndAttoRep);
		}
		// Remove settled intervals only when exporting to a descendant. Claims
		// within this game retain their fixed positions regardless of claim order.
		uint256 consumedBeforeAttoRep = _consumedPrincipalBefore(outcomeIndex, leafIndex);
		// Reward positions never compact: a direct claim must not make a later
		// deposit eligible for an earlier, already-paid reward interval.
		return (
			startAttoRep - consumedBeforeAttoRep,
			endAttoRep - consumedBeforeAttoRep,
			rewardStartAttoRep,
			rewardEndAttoRep
		);
	}

	function _sourceClaimInterval(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex)
		private
		view
		returns (uint256 startAttoRep, uint256 endAttoRep, uint256 rewardStartAttoRep, uint256 rewardEndAttoRep)
	{
		require(outcomeIndex < 3 && cumulativeAmountAttoRep >= amountAttoRep, 'Invalid claim interval');
		if (forkCarrySourceGame == address(0x0) || leafIndex >= outcomeState[outcomeIndex].snapshotLeafCount) {
			return (
				cumulativeAmountAttoRep - amountAttoRep,
				cumulativeAmountAttoRep,
				cumulativeAmountAttoRep - amountAttoRep,
				cumulativeAmountAttoRep
			);
		}
		return
			IEscalationClaimCheckpointSource(forkCarrySourceGame).getUnresolvedClaimInterval(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
	}

	function initializeForkClaimCheckpoint(address sourceGame) external {
		require(msg.sender == IEscalationClaimGameContext(address(this)).securityPool(), 'Only pool');
		require(sourceGame == forkCarrySourceGame, 'Claim source');
		require(truthAuctionRepBeforeAttoRep == 0, 'Haircut applied');
		address rootSource = IEscalationClaimCheckpointSource(sourceGame).rootClaimSourceGame();
		forkCarryRootClaimSourceGame = rootSource == address(0x0) ? sourceGame : rootSource;
	}
}
