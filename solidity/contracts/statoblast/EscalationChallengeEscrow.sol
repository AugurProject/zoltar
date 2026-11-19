// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGame } from './EscalationGame.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';

/// @notice One immutable collective challenge. Anyone may deploy a round for a live game.
/// Pending REP is withdrawable and has no reporting rights. Activation creates ordinary
/// game deposits owned by the contributors, including their existing fork-carry rights.
contract EscalationChallengeEscrow {
	using SafeERC20Ops for IERC20;

	EscalationGame public immutable game;
	BinaryOutcomes.BinaryOutcome public immutable outcome;
	uint256 public immutable deadline;
	IERC20 public immutable token;
	uint256 public totalPendingAttoRep;
	bool public activated;
	bool private entered;
	address[16] public contributors;
	mapping(address => uint256) public contributionsAttoRep;

	event Contributed(address indexed contributor, uint256 amountAttoRep);
	event Withdrawn(address indexed contributor, uint256 amountAttoRep);
	event Activated(uint256 amountAttoRep);

	modifier nonReentrant() {
		require(!entered, 'Escrow reentry');
		entered = true;
		_;
		entered = false;
	}

	constructor(EscalationGame _game, BinaryOutcomes.BinaryOutcome _outcome, uint256 _deadline) {
		require(_outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(_deadline > block.timestamp && _deadline <= _game.getEscalationGameEndDate(), 'Invalid challenge deadline');
		game = _game;
		outcome = _outcome;
		deadline = _deadline;
		token = IERC20(address(_game.repToken()));
		_requireOpen();
	}

	/// @notice Accept the full amount for the caller, or revert. A stale transaction cannot
	/// join an activated round. The fixed round deadline must fit within the caller's consent.
	function contribute(uint256 amountAttoRep, uint256 validUntil) external nonReentrant {
		require(block.timestamp <= validUntil, 'Contribution expired');
		require(deadline <= validUntil, 'Challenge outlasts consent');
		_requireOpen();
		uint256 startBondAttoRep = game.startBondAttoRep();
		require(amountAttoRep >= startBondAttoRep, 'Below start bond');
		uint256 roomAttoRep = game.nonDecisionThresholdAttoRep() - game.getOutcomeBalancesAttoRep()[uint8(outcome)];
		if (contributionsAttoRep[msg.sender] == 0) _insertContributor(amountAttoRep);
		require(totalPendingAttoRep + amountAttoRep <= roomAttoRep, 'Challenge exceeds room');
		contributionsAttoRep[msg.sender] += amountAttoRep;
		totalPendingAttoRep += amountAttoRep;
		token.safeTransferFrom(msg.sender, address(this), amountAttoRep);
		emit Contributed(msg.sender, amountAttoRep);
		if (canActivate()) {
			_activate();
			return;
		}
		// Every later contribution is at least the start bond and must fit the room, so a
		// smaller remainder could never be filled. A round that only activates at the exact
		// threshold would then stay blocked by this freely withdrawable contribution.
		uint256 remainingAttoRep = roomAttoRep - totalPendingAttoRep;
		require(remainingAttoRep == 0 || remainingAttoRep >= startBondAttoRep, 'Challenge leaves unfillable room');
	}

	/// @notice Only unactivated contributions can be withdrawn, including after expiry or a fork.
	function withdraw() external nonReentrant {
		require(!activated, 'Challenge activated');
		uint256 amount = contributionsAttoRep[msg.sender];
		require(amount != 0, 'No contribution');
		delete contributionsAttoRep[msg.sender];
		totalPendingAttoRep -= amount;
		for (uint256 index = 0; index < 16; index++) {
			if (contributors[index] == msg.sender) {
				delete contributors[index];
				break;
			}
		}
		token.safeTransfer(msg.sender, amount);
		emit Withdrawn(msg.sender, amount);
	}

	/// @notice Permissionless completion never grants the caller contributor rights.
	function activate() external nonReentrant {
		_requireOpen();
		require(canActivate(), 'Challenge not funded');
		_activate();
	}

	function canActivate() public view returns (bool) {
		if (activated || block.timestamp > deadline || totalPendingAttoRep == 0) return false;
		if (!_isGameActive()) return false;
		try game.previewDepositOnOutcome(outcome, totalPendingAttoRep) returns (uint256 accepted, uint256 cumulative) {
			if (accepted != totalPendingAttoRep) return false;
			uint256[3] memory balances = game.getOutcomeBalancesAttoRep();
			for (uint8 index = 0; index < 3; index++) {
				if (
					index != uint8(outcome) &&
					cumulative <= balances[index] &&
					cumulative != game.nonDecisionThresholdAttoRep()
				) return false;
			}
			return true;
		} catch {
			return false;
		}
	}

	function _requireOpen() private view {
		require(!activated && block.timestamp <= deadline, 'Challenge closed');
		require(_isGameActive(), 'Game inactive');
		// Validate that this outcome can still receive a report, without requiring the
		// pending funds themselves to satisfy the curve. No tokens move in this quote.
		game.previewDepositOnOutcome(outcome, game.nonDecisionThresholdAttoRep());
	}

	function _isGameActive() private view returns (bool) {
		if (
			game.forkContinuation() &&
			(game.forkResumedAt() == 0 || game.fixedQuestionOutcome() != BinaryOutcomes.BinaryOutcome.None)
		) return false;
		ISecurityPool pool = game.securityPool();
		return
			pool.systemState() == SystemState.Operational &&
			pool.zoltar().getForkTime(pool.universeId()) == 0 &&
			address(pool.escalationGame()) == address(game);
	}

	// Keep the sixteen largest pending contributions. Cheap sybil deposits cannot
	// reserve every slot: a larger funder refunds the smallest owner's full REP.
	function _insertContributor(uint256 amountAttoRep) private {
		uint256 smallest;
		for (uint256 index = 0; index < 16; index++) {
			address contributor = contributors[index];
			if (contributor == address(0)) {
				contributors[index] = msg.sender;
				return;
			}
			if (contributionsAttoRep[contributor] < contributionsAttoRep[contributors[smallest]]) smallest = index;
		}
		address refunded = contributors[smallest];
		uint256 amount = contributionsAttoRep[refunded];
		require(amountAttoRep > amount, 'Challenge contributor limit');
		delete contributionsAttoRep[refunded];
		totalPendingAttoRep -= amount;
		contributors[smallest] = msg.sender;
		token.safeTransfer(refunded, amount);
		emit Withdrawn(refunded, amount);
	}

	function _activate() private {
		uint256 count;
		for (uint256 index = 0; index < 16; index++) if (contributors[index] != address(0)) count++;
		address[] memory beneficiaries = new address[](count);
		uint256[] memory amounts = new uint256[](count);
		uint256 next;
		for (uint256 index = 0; index < 16; index++) {
			address contributor = contributors[index];
			if (contributor == address(0)) continue;
			beneficiaries[next] = contributor;
			amounts[next++] = contributionsAttoRep[contributor];
		}
		activated = true;
		uint256 amount = totalPendingAttoRep;
		totalPendingAttoRep = 0;
		token.safeApprove(address(game), amount);
		game.depositRepOnOutcomeForBatch(outcome, beneficiaries, amounts);
		token.safeApprove(address(game), 0);
		emit Activated(amount);
	}
}
