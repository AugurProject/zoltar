// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGameClaimDelegate } from '../../statoblast/EscalationGameClaimDelegate.sol';

// Supplies exact per-generation accounting to exercise the production claim
// delegate without requiring thousands of reporter deposits or repeated forks.
contract EscalationClaimCheckpointHarness is EscalationGameClaimDelegate {
	uint8 public systemState = 1;
	uint256 public forkActivationTime = 1;

	constructor(address source, uint256 snapshotLeafCount, uint256 repBeforeAttoRep, uint256 repRemainingAttoRep, uint256 consumedBeforeAttoRep) {
		forkCarrySourceGame = source;
		forkContinuation = source != address(0x0);
		forkCarrySnapshotOutcomesInitialized = 3;
		truthAuctionRepBeforeAttoRep = repBeforeAttoRep;
		truthAuctionRepRemainingAttoRep = repRemainingAttoRep;
		for (uint256 index = 0; index < 3; index++) {
			outcomeState[index].snapshotLeafCount = snapshotLeafCount;
			outcomeState[index].consumedPrincipalTree[1] = consumedBeforeAttoRep;
		}
	}

	function securityPool() external view returns (address) {
		return address(this);
	}
	function securityPoolForker() external view returns (address) {
		return address(this);
	}

	function forkData(address)
		external
		view
		returns (uint256, address, uint256, uint256, uint256, uint256, uint256, uint256, bool, bool, uint256, uint256)
	{
		return (0, address(0x0), 0, 0, 0, 0, 0, 0, true, true, 0, forkActivationTime);
	}

	function setForkState(uint8 state, uint256 activatedAt) external {
		systemState = state;
		forkActivationTime = activatedAt;
	}

	function setConsumedBefore(uint8 outcomeIndex, uint256 amountAttoRep) external {
		outcomeState[outcomeIndex].consumedPrincipalTree[1] = amountAttoRep;
	}

	function setRetention(uint256 beforeAttoRep, uint256 remainingAttoRep) external {
		truthAuctionRepBeforeAttoRep = beforeAttoRep;
		truthAuctionRepRemainingAttoRep = remainingAttoRep;
	}

	function setSnapshotProgress(uint8 outcomesInitialized) external {
		forkCarrySnapshotOutcomesInitialized = outcomesInitialized;
	}
}
