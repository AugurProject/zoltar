// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { BinaryOutcomes } from '../../statoblast/BinaryOutcomes.sol';
import { EscalationGame } from '../../statoblast/EscalationGame.sol';
import { CarriedDepositProof } from '../../statoblast/EscalationGameTypes.sol';
import { MerkleMountainRange } from '../../statoblast/MerkleMountainRange.sol';
import { SecurityPoolReporterLedger } from '../../statoblast/SecurityPoolReporterLedger.sol';

/// @dev One test contract that is the game's question ledger, its bound security pool, and the
/// pool's reporter custody. Escalation games always run under security pool custody; this keeps
/// that custody path real while letting tests drive the ledger and carry snapshots directly.
contract EscalationGameProofTestQuestionLedger {
	Zoltar public immutable zoltar;
	uint248 public immutable universeId;
	EscalationGame public escalationGame;
	// Reporter custody for the one bound game; REP is held by this contract.
	uint256 private reporterBalanceAttoRep;

	constructor(Zoltar zoltarAddress, uint248 configuredUniverseId) {
		zoltar = zoltarAddress;
		universeId = configuredUniverseId;
		zoltarAddress.getRepToken(configuredUniverseId).approve(address(zoltarAddress), type(uint256).max);
	}

	function questionId() public pure virtual returns (uint256) {
		return 0;
	}

	function questionForker() external view returns (address) {
		return address(this);
	}

	function getQuestionOutcome(address) external view returns (BinaryOutcomes.BinaryOutcome) {
		return escalationGame.getFinalQuestionResolution();
	}

	function systemState() external pure returns (uint8) {
		return 0;
	}

	function setEscalationGame(EscalationGame game) external {
		require(address(escalationGame) == address(0), 'Escalation game proof harness already has a configured game');
		escalationGame = game;
	}

	function resumeEscalationGameFromFork() external {
		escalationGame.resumeFromFork();
	}

	function repToken() public view returns (ReputationToken) {
		return zoltar.getRepToken(universeId);
	}

	// Security pool binding.
	function securityPoolCustody() external view virtual returns (address) {
		return address(this);
	}

	function securityPoolFactory() external view virtual returns (address) {
		return address(this);
	}

	function securityPoolOf(address) external view virtual returns (address) {
		return address(this);
	}

	function reporterLedger(uint248) external view virtual returns (address) {
		return address(this);
	}

	function settlement() external pure returns (address) {
		return address(0);
	}

	function securityPoolTimeForNative(uint248, uint48 timestamp) public view virtual returns (uint48) {
		return timestamp == 0 ? uint48(block.timestamp) : timestamp;
	}

	function nativeTimeForSecurityPoolTime(uint248, uint48 timestamp) external view virtual returns (uint48) {
		return timestamp;
	}

	function registerReporterGame(address game) external virtual {
		require(game == address(escalationGame), 'Wrong test game');
	}

	function onQuestionFinalityChanged(uint48) external view virtual {
		require(msg.sender == address(escalationGame), 'Only test game');
	}

	// Reporter custody.
	function question(uint248, uint256) external pure returns (SecurityPoolReporterLedger.Question memory state, bool finalClaim) {}

	function balanceOfGame(address game) external view returns (uint256) {
		return game == address(escalationGame) ? reporterBalanceAttoRep : 0;
	}

	function depositAndScheduleFinality(address game, uint256 amountAttoRep, uint48) external {
		require(msg.sender == game && game == address(escalationGame), 'Only test game');
		reporterBalanceAttoRep += amountAttoRep;
	}

	function transferFromGame(address game, address recipient, uint256 amountAttoRep) external {
		require(msg.sender == game && game == address(escalationGame), 'Only test game');
		reporterBalanceAttoRep -= amountAttoRep;
		if (recipient != address(this)) require(repToken().transfer(recipient, amountAttoRep), 'Transfer failed');
	}

	function scheduleFinality(address game, uint48) external view {
		require(msg.sender == game && game == address(escalationGame), 'Only test game');
	}

	/// @notice Credits REP pulled from the caller to the game's reporter custody, as fork migration does.
	function fundReporterBalance(uint256 amountAttoRep) public virtual {
		require(repToken().transferFrom(msg.sender, address(this), amountAttoRep), 'Transfer failed');
		reporterBalanceAttoRep += amountAttoRep;
	}

	// Question ledger callbacks.
	function burnEscalationWinnerHaircut(uint256 amount) external {
		require(msg.sender == address(escalationGame), 'Only game');
		zoltar.burnRep(universeId, amount);
	}

	function creditEscalationSurplus(uint256) external view {
		require(msg.sender == address(escalationGame), 'Only game');
	}

	function refreshSecurityPoolFees() external view {
		require(msg.sender == address(escalationGame), 'Only game');
	}

	function depositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) external returns (uint256, uint256) {
		(uint256 acceptedAmount, uint256 resultingCumulativeAmount) = escalationGame.previewDepositOnOutcome(outcome, amount);
		require(repToken().transferFrom(msg.sender, address(escalationGame), acceptedAmount), 'Transfer failed');
		uint256 parentDepositIndex = escalationGame.recordDepositFromQuestionLedger(depositor, outcome, acceptedAmount, resultingCumulativeAmount);
		return (acceptedAmount, parentDepositIndex);
	}

	function recordDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount, uint256 expectedCumulativeAmount) external returns (uint256 parentDepositIndex) {
		return escalationGame.recordDepositFromQuestionLedger(depositor, outcome, amount, expectedCumulativeAmount);
	}

	function initializeForkCarrySnapshot(bytes32[64][3] memory inheritedCarryPeaks, uint256[3] memory inheritedCarryLeafCounts, uint256[3] memory inheritedCarryTotals) external {
		_fundOnce(inheritedCarryTotals[0] + inheritedCarryTotals[1] + inheritedCarryTotals[2]);
		_initializeSnapshot(address(0x0), bytes32(0), inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedCarryTotals);
	}

	function initializeForkCarrySnapshotWithResolutionBalances(bytes32[64][3] memory inheritedCarryPeaks, uint256[3] memory inheritedCarryLeafCounts, uint256[3] memory inheritedCarryTotals, uint256[3] memory inheritedResolutionBalances) external {
		_fundOnce(inheritedResolutionBalances[0] + inheritedResolutionBalances[1] + inheritedResolutionBalances[2]);
		_initializeSnapshot(address(0x0), bytes32(0), inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedResolutionBalances);
	}

	function initializeForkCarrySnapshotFromSource(address sourceGame, bytes32 snapshotId, bytes32[64][3] memory inheritedCarryPeaks, uint256[3] memory inheritedCarryLeafCounts, uint256[3] memory inheritedCarryTotals) external {
		_fundOnce(inheritedCarryTotals[0] + inheritedCarryTotals[1] + inheritedCarryTotals[2]);
		_initializeSnapshot(sourceGame, snapshotId, inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedCarryTotals);
	}

	function _fundOnce(uint256 amountAttoRep) private {
		if (amountAttoRep > 0 && escalationGame.forkCarrySnapshotOutcomesInitialized() == 0)
			fundReporterBalance(amountAttoRep);
	}

	function _initializeSnapshot(address sourceGame, bytes32 snapshotId, bytes32[64][3] memory peaks, uint256[3] memory leafCounts, uint256[3] memory totals, uint256[3] memory balances) private {
		uint8 nextOutcome = escalationGame.forkCarrySnapshotOutcomesInitialized();
		require(nextOutcome < 3, 'Snapshot initialized');
		if (snapshotId == bytes32(0)) {
			bytes32[3] memory roots;
			for (uint8 outcome = 0; outcome < 3; outcome++) {
				bytes32 root;
				bool first = true;
				for (uint256 height = 64; height > 0; ) {
					unchecked {
						--height;
					}
					if (((leafCounts[outcome] >> height) & 1) == 0) continue;
					root =
						first ? peaks[outcome][height] : MerkleMountainRange.hashParent(peaks[outcome][height], root);
					first = false;
				}
				roots[outcome] = root;
			}
			snapshotId = keccak256(abi.encode(sourceGame, roots, leafCounts, totals, balances));
		}
		escalationGame.initializeForkCarryOutcome(sourceGame, snapshotId, peaks[nextOutcome], leafCounts[nextOutcome], totals[nextOutcome], balances[nextOutcome]);
	}

	function withdrawDeposit(BinaryOutcomes.BinaryOutcome outcome, CarriedDepositProof calldata proof) external returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep) {
		return escalationGame.withdrawDeposit(proof, outcome);
	}

	function withdrawLocalDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) external returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep) {
		return escalationGame.withdrawDeposit(depositIndex, outcome);
	}

	function sweepResidualRepToQuestionLedger() external {
		escalationGame.sweepResidualRepToQuestionLedger();
	}
}
