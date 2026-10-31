// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

struct EscalationClaimInterval {
	uint256 startAttoRep;
	uint256 endAttoRep;
	uint256 rewardStartAttoRep;
	uint256 rewardEndAttoRep;
}

struct EscalationClaimTransform {
	uint256 repBeforeAttoRep;
	uint256 repRemainingAttoRep;
	uint256 consumedBeforeAttoRep;
}

struct EscalationClaimCheckpointSegment {
	address sourceGame;
	bytes32 previousCommitment;
}

struct EscalationClaimCheckpoint {
	address nextSourceGame;
	bool initialized;
	bool complete;
	bool stopAfterNextSource;
	uint256 pendingSteps;
	EscalationClaimInterval interval;
	bytes32 pendingCommitment;
	address reusedCheckpointGame;
	mapping(uint256 => EscalationClaimCheckpointSegment) segments;
}
