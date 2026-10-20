// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGameRepCustody } from './EscalationGameRepCustody.sol';
import { EscalationGameStorage } from './EscalationGameStorage.sol';
import {
	EscalationClaimInterval,
	EscalationClaimTransform,
	EscalationClaimCheckpointSegment,
	EscalationClaimCheckpoint
} from './EscalationClaimCheckpointTypes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SystemState } from './interfaces/ISecurityPool.sol';

interface IEscalationClaimGameContext {
	function securityPool() external view returns (address);
}

interface IEscalationClaimCheckpointSource {
	function getClaimIntervalTransform(uint8 outcomeIndex, uint256 leafIndex) external view returns (address, EscalationClaimTransform memory);
	function isClaimHistoryFrozen() external view returns (bool);
	function rootClaimSourceGame() external view returns (address);
	function getReusableClaimCheckpoint(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) external view returns (bool, address, EscalationClaimInterval memory);
}

interface IEscalationClaimPoolContext {
	function securityPoolForker() external view returns (address);
	function systemState() external view returns (SystemState);
}

interface IEscalationClaimForkerContext {
	function forkData(address pool)
		external
		view
		returns (uint256, address, uint256, uint256, uint256, uint256, uint256, uint256, bool, bool, uint256, uint256);
}

// Claim identity stays in the authenticated MMR leaf. Checkpoints contain only
// commitments to canonical ancestor transforms. Supplied transform batches must
// match those commitments; sparse anchors allow recovery from current state.
contract EscalationGameClaimDelegate is EscalationGameStorage {
	uint256 private constant MAX_CLAIM_STEPS = 8;
	event ClaimCheckpointProgress(bytes32 indexed claimId, address nextSourceGame, uint256 pendingSteps, bool complete);

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
		EscalationClaimInterval memory interval = _sourceClaimInterval(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		sourceAmountAttoRep = interval.endAttoRep - interval.startAttoRep;
		retainedAmountAttoRep =
			_applyTruthAuctionRetention(interval.endAttoRep) - _applyTruthAuctionRetention(interval.startAttoRep);
		retainedCumulativeAttoRep = _applyTruthAuctionRetention(interval.rewardEndAttoRep);
		rewardAmountAttoRep = retainedCumulativeAttoRep - _applyTruthAuctionRetention(interval.rewardStartAttoRep);
	}

	function getUnresolvedClaimInterval(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) external view returns (uint256, uint256, uint256, uint256) {
		EscalationClaimInterval memory interval = _sourceClaimInterval(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		(, EscalationClaimTransform memory transform) = _localTransform(outcomeIndex, leafIndex);
		interval = _applyTransform(interval, transform);
		return (interval.startAttoRep, interval.endAttoRep, interval.rewardStartAttoRep, interval.rewardEndAttoRep);
	}

	/// @notice One local step only; this getter never calls an ancestor.
	function getClaimIntervalTransform(uint8 outcomeIndex, uint256 leafIndex) external view returns (address sourceGame, EscalationClaimTransform memory transform) {
		_requireSnapshotReady();
		require(outcomeIndex < 3 && leafIndex < (uint256(1) << 64), 'Invalid claim interval');
		return _localTransform(outcomeIndex, leafIndex);
	}

	/// @notice A forked source stops changing only after its direct-claim window closes.
	function isClaimHistoryFrozen() external view returns (bool) {
		address pool = IEscalationClaimGameContext(address(this)).securityPool();
		IEscalationClaimPoolContext sourcePool = IEscalationClaimPoolContext(pool);
		if (sourcePool.systemState() != SystemState.PoolForked) return false;
		(, , , , , , , , , , , uint256 forkActivationTime) = IEscalationClaimForkerContext(sourcePool.securityPoolForker()).forkData(pool);
		return forkActivationTime != 0 && block.timestamp > forkActivationTime + SecurityPoolUtils.MIGRATION_TIME;
	}

	/// @notice Discovers or applies at most eight ancestry steps per call.
	/// @dev Empty transforms with a zero base discover frozen history. Once discovery
	/// finishes, batches hash forward from their base and apply in reverse. The immediate
	/// parent's transform stays live and is never included in the stored interval.
	function processClaimCheckpoint(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex, uint256 maxSteps, bytes32 baseCommitment, EscalationClaimTransform[] calldata transforms) external returns (bool complete) {
		_validateClaim(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		require(maxSteps > 0 && maxSteps <= MAX_CLAIM_STEPS && transforms.length <= maxSteps, 'Invalid checkpoint budget');
		require(transforms.length != 0 || baseCommitment == bytes32(0), 'Invalid checkpoint base');
		bytes32 claimId = _claimKey(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		EscalationClaimCheckpoint storage checkpoint = claimCheckpoints[claimId];
		if (_hasCentralReporterCustody()) {
			checkpoint.initialized = true;
			checkpoint.complete = true;
			checkpoint.interval = _initialInterval(amountAttoRep, cumulativeAmountAttoRep);
			return true;
		}
		if (
			!checkpoint.complete &&
			_adoptParentCheckpoint(checkpoint, outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex)
		) {
			emit ClaimCheckpointProgress(claimId, address(0x0), 0, true);
			return true;
		}
		if (!checkpoint.initialized) {
			checkpoint.initialized = true;
			checkpoint.interval = _initialInterval(amountAttoRep, cumulativeAmountAttoRep);
			if (_hasInheritedSource(outcomeIndex, leafIndex)) {
				(checkpoint.nextSourceGame, ) = IEscalationClaimCheckpointSource(forkCarrySourceGame).getClaimIntervalTransform(outcomeIndex, leafIndex);
			}
		}
		if (!checkpoint.complete && checkpoint.nextSourceGame != address(0x0)) {
			require(transforms.length == 0, 'Checkpoint discovery pending');
			for (uint256 step = 0; step < maxSteps && checkpoint.nextSourceGame != address(0x0); step++) {
				address sourceGame = checkpoint.nextSourceGame;
				IEscalationClaimCheckpointSource source = IEscalationClaimCheckpointSource(sourceGame);
				require(source.isClaimHistoryFrozen(), 'Claim source still mutable');
				(address nextSource, EscalationClaimTransform memory transform) = source.getClaimIntervalTransform(outcomeIndex, leafIndex);
				if (checkpoint.pendingSteps % MAX_CLAIM_STEPS == 0) {
					checkpoint.segments[checkpoint.pendingSteps / MAX_CLAIM_STEPS] = EscalationClaimCheckpointSegment(sourceGame, checkpoint.pendingCommitment);
				}
				checkpoint.pendingCommitment = _transformCommitment(claimId, checkpoint.pendingCommitment, transform);
				checkpoint.pendingSteps++;
				if (checkpoint.stopAfterNextSource) {
					nextSource = address(0x0);
					checkpoint.stopAfterNextSource = false;
				} else {
					_reuseCheckpoint(checkpoint, sourceGame, nextSource, outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
				}
				checkpoint.nextSourceGame = nextSource;
			}
		} else if (!checkpoint.complete && checkpoint.pendingSteps != 0) {
			uint256 pendingSteps = checkpoint.pendingSteps;
			require(transforms.length > 0 && transforms.length <= pendingSteps, 'Checkpoint transforms required');
			bytes32 commitment = baseCommitment;
			for (uint256 step = 0; step < transforms.length; step++) {
				commitment = _transformCommitment(claimId, commitment, transforms[step]);
			}
			require(commitment == checkpoint.pendingCommitment, 'Invalid checkpoint batch');
			EscalationClaimInterval memory interval = checkpoint.interval;
			for (uint256 remaining = transforms.length; remaining != 0; ) {
				interval = _applyTransform(interval, transforms[--remaining]);
				pendingSteps--;
				if (pendingSteps % MAX_CLAIM_STEPS == 0) delete checkpoint.segments[pendingSteps / MAX_CLAIM_STEPS];
			}
			checkpoint.interval = interval;
			checkpoint.pendingCommitment = baseCommitment;
			checkpoint.pendingSteps = pendingSteps;
		}
		complete = checkpoint.nextSourceGame == address(0x0) && checkpoint.pendingSteps == 0;
		checkpoint.complete = complete;
		emit ClaimCheckpointProgress(claimId, checkpoint.nextSourceGame, checkpoint.pendingSteps, complete);
	}

	/// @notice A completed cache excludes this game's immediate source transform.
	function getReusableClaimCheckpoint(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) external view returns (bool complete, address anchorSourceGame, EscalationClaimInterval memory interval) {
		_validateClaim(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		if (_hasCentralReporterCustody())
			return (true, forkCarrySourceGame, _initialInterval(amountAttoRep, cumulativeAmountAttoRep));
		EscalationClaimCheckpoint storage checkpoint = claimCheckpoints[
			_claimKey(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex)
		];
		return (
			checkpoint.complete,
			_hasInheritedSource(outcomeIndex, leafIndex) ? forkCarrySourceGame : address(0x0),
			checkpoint.interval
		);
	}

	function getClaimCheckpointState(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex)
		external
		view
		returns (
			bool initialized,
			bytes32 pendingCommitment,
			address reusedCheckpointGame,
			EscalationClaimInterval memory interval
		)
	{
		_validateClaim(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		EscalationClaimCheckpoint storage checkpoint = claimCheckpoints[
			_claimKey(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex)
		];
		return (
			checkpoint.initialized,
			checkpoint.pendingCommitment,
			checkpoint.reusedCheckpointGame,
			checkpoint.interval
		);
	}

	/// @notice At most eight canonical getter reads reconstruct the active segment.
	function getClaimCheckpointWitnessSegment(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) external view returns (address sourceGame, bytes32 previousCommitment, uint256 firstStep, uint256 steps) {
		_validateClaim(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		EscalationClaimCheckpoint storage checkpoint = claimCheckpoints[
			_claimKey(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex)
		];
		if (checkpoint.pendingSteps == 0) return (address(0x0), bytes32(0), 0, 0);
		uint256 segmentIndex = (checkpoint.pendingSteps - 1) / MAX_CLAIM_STEPS;
		EscalationClaimCheckpointSegment storage segment = checkpoint.segments[segmentIndex];
		firstStep = segmentIndex * MAX_CLAIM_STEPS;
		return (segment.sourceGame, segment.previousCommitment, firstStep, checkpoint.pendingSteps - firstStep);
	}

	// Retry the immediate parent's immutable prefix on every call. A cheap early
	// preparation cannot prevent adoption of a cache completed later. Discarded
	// segment anchors remain unreachable; deleting them would require a long loop.
	function _adoptParentCheckpoint(EscalationClaimCheckpoint storage checkpoint, uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) private returns (bool) {
		if (!_hasInheritedSource(outcomeIndex, leafIndex)) return false;
		IEscalationClaimCheckpointSource parent = IEscalationClaimCheckpointSource(forkCarrySourceGame);
		(bool complete, address anchor, EscalationClaimInterval memory interval) = parent.getReusableClaimCheckpoint(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		if (!complete) return false;
		(address sourceGame, ) = parent.getClaimIntervalTransform(outcomeIndex, leafIndex);
		require(anchor == sourceGame, 'Invalid checkpoint anchor');
		if (sourceGame != address(0x0)) {
			IEscalationClaimCheckpointSource source = IEscalationClaimCheckpointSource(sourceGame);
			require(source.isClaimHistoryFrozen(), 'Claim source still mutable');
			(, EscalationClaimTransform memory transform) = source.getClaimIntervalTransform(outcomeIndex, leafIndex);
			interval = _applyTransform(interval, transform);
		}
		checkpoint.initialized = true;
		checkpoint.complete = true;
		checkpoint.stopAfterNextSource = false;
		checkpoint.nextSourceGame = address(0x0);
		checkpoint.pendingSteps = 0;
		checkpoint.pendingCommitment = bytes32(0);
		checkpoint.interval = interval;
		checkpoint.reusedCheckpointGame = forkCarrySourceGame;
		return true;
	}

	function _reuseCheckpoint(EscalationClaimCheckpoint storage checkpoint, address sourceGame, address nextSource, uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) private {
		if (nextSource == address(0x0)) return;
		(bool complete, address anchor, EscalationClaimInterval memory interval) = IEscalationClaimCheckpointSource(sourceGame).getReusableClaimCheckpoint(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		if (!complete) return;
		require(anchor == nextSource, 'Invalid checkpoint anchor');
		checkpoint.interval = interval;
		checkpoint.reusedCheckpointGame = sourceGame;
		checkpoint.stopAfterNextSource = true;
	}

	function _transformCommitment(bytes32 claimId, bytes32 previousCommitment, EscalationClaimTransform memory transform) private view returns (bytes32) {
		return
			keccak256(abi.encode(address(this), claimId, previousCommitment, transform.repBeforeAttoRep, transform.repRemainingAttoRep, transform.consumedBeforeAttoRep));
	}

	/// @notice `ready` includes the bounded view fallback; `complete` means a stored checkpoint exists.
	function getClaimCheckpointProgress(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) external view returns (address nextSourceGame, uint256 pendingSteps, bool complete, bool ready) {
		_validateClaim(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		if (_hasCentralReporterCustody()) return (address(0), 0, true, true);
		EscalationClaimCheckpoint storage checkpoint = claimCheckpoints[
			_claimKey(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex)
		];
		nextSourceGame = checkpoint.nextSourceGame;
		pendingSteps = checkpoint.pendingSteps;
		complete = checkpoint.complete;
		if (complete || !_hasInheritedSource(outcomeIndex, leafIndex))
			return (nextSourceGame, pendingSteps, complete, true);
		address sourceGame = forkCarrySourceGame;
		for (uint256 step = 0; step < MAX_CLAIM_STEPS; step++) {
			(sourceGame, ) = IEscalationClaimCheckpointSource(sourceGame).getClaimIntervalTransform(outcomeIndex, leafIndex);
			if (step == 0 && !checkpoint.initialized) nextSourceGame = sourceGame;
			if (sourceGame == address(0x0)) return (nextSourceGame, pendingSteps, complete, true);
		}
	}

	function _sourceClaimInterval(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) private view returns (EscalationClaimInterval memory interval) {
		_validateClaim(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex);
		interval = _initialInterval(amountAttoRep, cumulativeAmountAttoRep);
		// Central live reporter lineages have no claim exports or recap haircuts.
		// Finalized questions stay in their finalizing universe, so inherited
		// principal/reward coordinates are unchanged across every live fork.
		if (_hasCentralReporterCustody() || !_hasInheritedSource(outcomeIndex, leafIndex)) return interval;
		EscalationClaimCheckpoint storage checkpoint = claimCheckpoints[
			_claimKey(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex)
		];
		if (checkpoint.complete) {
			(, EscalationClaimTransform memory immediateParent) = IEscalationClaimCheckpointSource(forkCarrySourceGame).getClaimIntervalTransform(outcomeIndex, leafIndex);
			return _applyTransform(checkpoint.interval, immediateParent);
		}
		EscalationClaimTransform[MAX_CLAIM_STEPS] memory transforms;
		address sourceGame = forkCarrySourceGame;
		uint256 count;
		while (sourceGame != address(0x0) && count < MAX_CLAIM_STEPS) {
			(sourceGame, transforms[count]) = IEscalationClaimCheckpointSource(sourceGame).getClaimIntervalTransform(outcomeIndex, leafIndex);
			count++;
		}
		require(sourceGame == address(0x0), 'Claim checkpoint required');
		while (count != 0) interval = _applyTransform(interval, transforms[--count]);
	}

	function _localTransform(uint8 outcomeIndex, uint256 leafIndex) private view returns (address sourceGame, EscalationClaimTransform memory transform) {
		if (leafIndex < outcomeState[outcomeIndex].snapshotLeafCount) {
			sourceGame = forkCarrySourceGame;
			transform.repBeforeAttoRep = truthAuctionRepBeforeAttoRep;
			transform.repRemainingAttoRep = truthAuctionRepRemainingAttoRep;
		}
		transform.consumedBeforeAttoRep = _consumedPrincipalBefore(outcomeIndex, leafIndex);
	}

	function _applyTransform(EscalationClaimInterval memory interval, EscalationClaimTransform memory transform) private pure returns (EscalationClaimInterval memory) {
		if (transform.repBeforeAttoRep != 0) {
			interval.startAttoRep =
				(interval.startAttoRep * transform.repRemainingAttoRep) / transform.repBeforeAttoRep;
			interval.endAttoRep = (interval.endAttoRep * transform.repRemainingAttoRep) / transform.repBeforeAttoRep;
			interval.rewardStartAttoRep =
				(interval.rewardStartAttoRep * transform.repRemainingAttoRep) / transform.repBeforeAttoRep;
			interval.rewardEndAttoRep =
				(interval.rewardEndAttoRep * transform.repRemainingAttoRep) / transform.repBeforeAttoRep;
		}
		// Settled principal compacts only the descendant's principal coordinate.
		// Reward coordinates must never move into previously paid reward windows.
		interval.startAttoRep -= transform.consumedBeforeAttoRep;
		interval.endAttoRep -= transform.consumedBeforeAttoRep;
		return interval;
	}

	function _initialInterval(uint256 amountAttoRep, uint256 cumulativeAmountAttoRep) private pure returns (EscalationClaimInterval memory) {
		return
			EscalationClaimInterval(cumulativeAmountAttoRep - amountAttoRep, cumulativeAmountAttoRep, cumulativeAmountAttoRep - amountAttoRep, cumulativeAmountAttoRep);
	}

	function _hasCentralReporterCustody() private view returns (bool) {
		return
			EscalationGameRepCustody.portfolio(IEscalationClaimGameContext(address(this)).securityPool()) != address(0);
	}

	function _hasInheritedSource(uint8 outcomeIndex, uint256 leafIndex) private view returns (bool) {
		return forkCarrySourceGame != address(0x0) && leafIndex < outcomeState[outcomeIndex].snapshotLeafCount;
	}

	function _claimKey(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) private pure returns (bytes32) {
		return keccak256(abi.encode(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex));
	}

	function _validateClaim(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex) private view {
		_requireSnapshotReady();
		require(outcomeIndex < 3 && cumulativeAmountAttoRep >= amountAttoRep && leafIndex < (uint256(1) << 64), 'Invalid claim interval');
	}

	function _requireSnapshotReady() private view {
		require(!forkContinuation || forkCarrySnapshotOutcomesInitialized == 3, 'Fork snapshot incomplete');
	}

	function initializeForkClaimCheckpoint(address sourceGame) external {
		require(msg.sender == IEscalationClaimGameContext(address(this)).securityPool(), 'Only pool');
		require(sourceGame == forkCarrySourceGame, 'Claim source');
		require(truthAuctionRepBeforeAttoRep == 0, 'Haircut applied');
		address rootSource = IEscalationClaimCheckpointSource(sourceGame).rootClaimSourceGame();
		forkCarryRootClaimSourceGame = rootSource == address(0x0) ? sourceGame : rootSource;
	}
}
