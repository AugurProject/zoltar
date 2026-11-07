// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGameClaimDelegate } from '../../statoblast/EscalationGameClaimDelegate.sol';

// Supplies exact per-generation accounting to exercise the production claim
// delegate without requiring thousands of reporter deposits or repeated forks.
contract EscalationClaimCheckpointHarness is EscalationGameClaimDelegate {
	uint8 public systemState = 1;
	uint8 public finalResolution = 3;
	uint256 public forkActivationTime = 1;

	constructor(address source, uint256 snapshotLeafCount, uint256 consumedBeforeAttoRep) {
		forkCarrySourceGame = source;
		forkContinuation = source != address(0x0);
		forkCarrySnapshotOutcomesInitialized = 3;
		for (uint256 index = 0; index < 3; index++) {
			outcomeState[index].snapshotLeafCount = snapshotLeafCount;
			outcomeState[index].consumedPrincipalTree[1] = consumedBeforeAttoRep;
		}
	}

	function securityPool() external view returns (address) {
		return address(this);
	}
	function zoltar() external view returns (address) {
		return address(this);
	}
	function universeId() external pure returns (uint248) {
		return 0;
	}
	function getForkTime(uint248) external view returns (uint256) {
		return systemState == 0 ? 0 : forkActivationTime;
	}
	function getFinalQuestionResolution() external view returns (uint8) {
		return finalResolution;
	}
	function setFinalResolution(uint8 outcome) external {
		finalResolution = outcome;
	}

	function setForkState(uint8 state, uint256 activatedAt) external {
		systemState = state;
		forkActivationTime = activatedAt;
	}

	function setConsumedBefore(uint8 outcomeIndex, uint256 amountAttoRep) external {
		outcomeState[outcomeIndex].consumedPrincipalTree[1] = amountAttoRep;
	}

	function setSnapshotProgress(uint8 outcomesInitialized) external {
		forkCarrySnapshotOutcomesInitialized = outcomesInitialized;
	}
}
