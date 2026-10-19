// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolPortfolioPosition } from './SecurityPoolPortfolioPosition.sol';
import { SecurityPoolPortfolioQuote } from './SecurityPoolPortfolioQuote.sol';
import { SecurityPoolPortfolioRecovery } from './SecurityPoolPortfolioRecovery.sol';
import { SecurityPoolPortfolioRecoveryDeployer } from './SecurityPoolPortfolioRecoveryDeployer.sol';
import { SecurityPoolPortfolioVault } from './SecurityPoolPortfolioVault.sol';

interface IPortfolioForkSource {
	function positionCount() external view returns (uint256);
	function getPool(uint256 questionId, uint248 universeId) external view returns (ISecurityPool);
	function getForkPosition(uint256 positionId) external view returns (address custody, uint256 remainingShares, uint256 unmigratedShares, bool complete);
	function collectForkPosition(uint256 positionId) external;
	function releaseForkPosition(uint256 positionId, address recipient, uint256 shares, address processor) external;
	function createForkVault(address owner) external returns (SecurityPoolPortfolioVault);
	function claimForkPosition(address owner, uint256 positionId, uint256 intervalId, bool migrate, uint256 outcomeIndex) external;
	function recoverForkPosition(uint256 positionId, address processor) external;
	function finalizeForkPosition(uint256 positionId) external;
}

/// @notice Owner-authorized branch groups share native migration and recovery work.
/// @dev Context zero is the origin reserve's historical ledger. Descendant contexts retain
/// the same allocation point IDs, but have independent ownership intervals and REP tokens.
contract SecurityPoolPortfolioForkController {
	using SafeERC20Ops for IERC20;

	uint256 public constant CHOICE_PERIOD = 4 weeks;
	uint256 private constant NATIVE_MIGRATION_PERIOD = 8 weeks;
	IPortfolioForkSource public immutable portfolio;
	Zoltar public immutable zoltar;
	SecurityPoolPortfolioQuote private immutable quoteHelper;
	SecurityPoolPortfolioRecoveryDeployer public immutable helpers;
	uint256 public contextCount = 1;
	bool private entered;

	struct Context {
		uint248 universeId;
		uint256 parentContextId;
		uint256 outcomeIndex;
		uint256 incomingActivationFloor;
		SecurityPoolPortfolioRecovery ledger;
		IERC20 repToken;
		uint256 pointCount;
	}

	struct Choice {
		bool selected;
		uint256 outcomeIndex;
		uint256 childIntervalId;
	}

	struct Position {
		SecurityPoolPortfolioPosition custody;
		uint256 remainingShares;
		uint256 unmigratedShares;
		bool recoveryComplete;
	}

	struct OwnerBranches {
		uint256 first;
		uint256 last;
		mapping(uint256 => uint256) selections;
		mapping(uint256 => uint256) next;
		mapping(uint256 => uint256) previous;
	}

	mapping(uint256 => Context) private contexts;
	mapping(uint256 => mapping(uint256 => uint256)) public childContextIds;
	mapping(uint256 => mapping(address => mapping(uint256 => Choice))) public choices;
	mapping(uint256 => mapping(uint256 => Position)) public positions;
	mapping(uint256 => mapping(uint256 => bool)) public processedPositions;
	mapping(address => address) private positionSourcePools;
	mapping(uint256 => uint256) public recoveredRep;
	mapping(uint256 => uint256) public recoveredFees;
	mapping(uint256 => mapping(address => OwnerBranches)) private ownerBranches;

	event ForkContextCreated(uint256 indexed contextId, uint256 indexed parentContextId, uint256 indexed outcomeIndex, uint248 universeId, SecurityPoolPortfolioRecovery ledger);
	event SharedForkChosen(uint256 indexed contextId, address indexed owner, uint256 indexed intervalId, uint256 outcomeIndex, uint256 childIntervalId);
	event SharedForkRevoked(uint256 indexed contextId, address indexed owner, uint256 indexed intervalId);
	event SharedForkMigrated(uint256 indexed contextId, uint256 indexed positionId, uint256 indexed childContextId, SecurityPoolPortfolioPosition custody, uint256 shares);
	event ForkPositionRecovered(uint256 indexed contextId, uint256 indexed positionId, uint256 repAttoRep, uint256 feesAttoEth, bool complete);
	event ForkRecoveryCollected(uint256 indexed contextId, address indexed owner, uint256 repAttoRep, uint256 feesAttoEth);
	event ForkPositionClaimed(uint256 indexed contextId, uint256 indexed positionId, address indexed owner, SecurityPoolPortfolioVault vault, uint256 shares);

	constructor(ISecurityPool initialPool, SecurityPoolPortfolioRecovery rootLedger, SecurityPoolPortfolioQuote _quoteHelper, SecurityPoolPortfolioRecoveryDeployer _helpers) {
		portfolio = IPortfolioForkSource(msg.sender);
		zoltar = initialPool.zoltar();
		quoteHelper = _quoteHelper;
		helpers = _helpers;
		contexts[0] = Context(initialPool.universeId(), 0, 0, 0, rootLedger, IERC20(address(initialPool.repToken())), 0);
	}

	modifier nonReentrant() {
		require(!entered, 'Fork operation active');
		entered = true;
		_;
		entered = false;
	}

	function getContext(uint256 contextId) public view returns (Context memory context) {
		require(contextId < contextCount, 'Unknown fork context');
		context = contexts[contextId];
		if (contextId == 0) context.pointCount = portfolio.positionCount();
	}

	/// @notice A common enrollment window that cannot be shortened by another pool's activation.
	/// A descendant pool cannot activate its outgoing fork before its incoming migration ends.
	function choiceWindow(uint256 contextId) public view returns (uint256 opensAt, uint256 closesAt) {
		Context memory context = getContext(contextId);
		opensAt = zoltar.getForkTime(context.universeId);
		if (opensAt == 0) return (0, 0);
		if (opensAt < context.incomingActivationFloor) opensAt = context.incomingActivationFloor;
		closesAt = opensAt + CHOICE_PERIOD;
	}

	function readPosition(uint256 contextId, uint256 positionId) public view returns (Position memory position) {
		Context memory context = getContext(contextId);
		require(positionId > 0 && positionId <= context.pointCount, 'Unknown allocation position');
		if (contextId != 0) return positions[contextId][positionId];
		(address custody, uint256 remaining, uint256 physical, bool complete) = portfolio.getForkPosition(positionId);
		return Position(SecurityPoolPortfolioPosition(payable(custody)), remaining, physical, complete);
	}

	function getBranchWeight(uint256 contextId, uint256 positionId, uint256 outcomeIndex) external view returns (uint256) {
		uint256 childId = childContextIds[contextId][outcomeIndex];
		return childId == 0 ? 0 : contexts[childId].ledger.getPointShares(positionId);
	}

	function isPositionSourceForPool(address source, address pool) external view returns (bool) {
		return pool != address(0) && positionSourcePools[source] == pool;
	}

	function isIntervalSelected(uint256 contextId, address owner, uint256 intervalId) external view returns (bool) {
		return choices[contextId][owner][intervalId].selected;
	}

	/// @notice Selected children remain discoverable after their source cash intervals retire.
	function getOwnerForkBranches(uint256 contextId, address owner, uint256 cursor, uint256 count) external view returns (uint256[] memory children, uint256 nextCursor) {
		require(count > 0, 'Choose a positive branch page size');
		OwnerBranches storage branches = ownerBranches[contextId][owner];
		require(cursor == 0 || branches.selections[cursor] > 0, 'Branch cursor retired');
		nextCursor = cursor == 0 ? branches.first : cursor;
		children = new uint256[](count);
		uint256 length;
		while (nextCursor != 0 && length < count) {
			children[length++] = nextCursor;
			nextCursor = branches.next[nextCursor];
		}
		assembly ('memory-safe') {
			mstore(children, length)
		}
	}

	function _addBranchSelection(uint256 contextId, uint256 childId) private {
		OwnerBranches storage branches = ownerBranches[contextId][msg.sender];
		if (branches.selections[childId]++ > 0) return;
		branches.previous[childId] = branches.last;
		if (branches.last == 0) branches.first = childId;
		else branches.next[branches.last] = childId;
		branches.last = childId;
	}

	function _removeBranchSelection(uint256 contextId, uint256 childId) private {
		OwnerBranches storage branches = ownerBranches[contextId][msg.sender];
		if (--branches.selections[childId] > 0) return;
		uint256 previous = branches.previous[childId];
		uint256 next = branches.next[childId];
		if (previous == 0) branches.first = next;
		else branches.next[previous] = next;
		if (next == 0) branches.last = previous;
		else branches.previous[next] = previous;
		delete branches.previous[childId];
		delete branches.next[childId];
	}

	/// @notice Assign caller-selected ownership intervals, with no question or owner scan.
	function chooseSharedFork(uint256 contextId, uint256[] calldata intervalIds, uint256 outcomeIndex) external nonReentrant {
		_requireChoiceWindow(contextId);
		Context memory context = getContext(contextId);
		(, uint256 forkQuestionId, , , ) = zoltar.universes(context.universeId);
		require(!zoltar.zoltarQuestionData().isMalformedAnswerOption(forkQuestionId, outcomeIndex), 'Malformed fork outcome');
		require(intervalIds.length > 0, 'Choose owner intervals');
		uint256 childId = _childContext(contextId, outcomeIndex);
		SecurityPoolPortfolioRecovery childLedger = contexts[childId].ledger;
		for (uint256 index; index < intervalIds.length; index++) {
			uint256 intervalId = intervalIds[index];
			require(index == 0 || intervalId > intervalIds[index - 1], 'Choose increasing owner intervals');
			SecurityPoolPortfolioRecovery.Interval memory interval = context.ledger.getOwnerInterval(msg.sender, intervalId);
			uint256 end = interval.open ? context.pointCount : interval.endPosition;
			require(interval.active && interval.shares > 0 && interval.startPosition <= end, 'No active allocation interval');
			require(end <= context.pointCount, 'Interval exceeds fork snapshot');
			Choice storage choice = choices[contextId][msg.sender][intervalId];
			if (choice.selected && choice.outcomeIndex == outcomeIndex) continue;
			if (choice.selected) _revoke(contextId, intervalId);
			uint256 imported = childLedger.importInterval(msg.sender, interval.startPosition, end, interval.shares);
			choices[contextId][msg.sender][intervalId] = Choice(true, outcomeIndex, imported);
			_addBranchSelection(contextId, childId);
			emit SharedForkChosen(contextId, msg.sender, intervalId, outcomeIndex, imported);
		}
	}

	function revokeSharedFork(uint256 contextId, uint256[] calldata intervalIds) external nonReentrant {
		_requireChoiceWindow(contextId);
		require(intervalIds.length > 0, 'Choose owner intervals');
		for (uint256 index; index < intervalIds.length; index++) {
			require(index == 0 || intervalIds[index] > intervalIds[index - 1], 'Choose increasing owner intervals');
			_revoke(contextId, intervalIds[index]);
		}
	}

	function _requireChoiceWindow(uint256 contextId) private view {
		(uint256 opensAt, uint256 closesAt) = choiceWindow(contextId);
		require(opensAt != 0 && block.timestamp >= opensAt && block.timestamp <= closesAt, 'Shared choice window closed');
	}

	function _revoke(uint256 contextId, uint256 intervalId) private {
		Choice memory choice = choices[contextId][msg.sender][intervalId];
		require(choice.selected, 'No shared fork choice');
		uint256 childId = childContextIds[contextId][choice.outcomeIndex];
		contexts[childId].ledger.retireImportedInterval(msg.sender, choice.childIntervalId);
		_removeBranchSelection(contextId, childId);
		delete choices[contextId][msg.sender][intervalId];
		emit SharedForkRevoked(contextId, msg.sender, intervalId);
	}

	function _childContext(uint256 contextId, uint256 outcomeIndex) private returns (uint256 childId) {
		childId = childContextIds[contextId][outcomeIndex];
		if (childId != 0) return childId;
		Context memory parent = getContext(contextId);
		(uint256 activationFloor, ) = choiceWindow(contextId);
		uint248 childUniverse = zoltar.getChildUniverseId(parent.universeId, outcomeIndex);
		if (address(zoltar.getRepToken(childUniverse)) == address(0))
			zoltar.deployChild(parent.universeId, outcomeIndex);
		SecurityPoolPortfolioRecovery ledger = helpers.createRecovery(parent.pointCount);
		childId = contextCount++;
		contexts[childId] = Context(childUniverse, contextId, outcomeIndex, activationFloor + NATIVE_MIGRATION_PERIOD, ledger, IERC20(address(zoltar.getRepToken(childUniverse))), parent.pointCount);
		childContextIds[contextId][outcomeIndex] = childId;
		emit ForkContextCreated(childId, contextId, outcomeIndex, childUniverse, ledger);
	}

	/// @notice Migrate one allocation once for the selected branch, regardless of its owner count.
	/// Missing incoming custody or an unsettled incoming native fork returns false; no ancestry scan.
	function processForkPosition(uint256 contextId, uint256 positionId, uint256 outcomeIndex) external nonReentrant returns (bool progressed) {
		return _processForkPosition(contextId, positionId, outcomeIndex);
	}

	function _processForkPosition(uint256 contextId, uint256 positionId, uint256 outcomeIndex) private returns (bool) {
		(uint256 opensAt, uint256 closesAt) = choiceWindow(contextId);
		require(opensAt != 0 && block.timestamp > closesAt, 'Shared choices still open');
		uint256 childId = childContextIds[contextId][outcomeIndex];
		require(childId != 0, 'No shared branch owners');
		Position memory source = readPosition(contextId, positionId);
		if (processedPositions[childId][positionId]) return false;
		Context storage child = contexts[childId];
		uint256 shares = child.ledger.getPointShares(positionId);
		require(shares > 0, 'No shared allocation owners');
		child.ledger.sealImports();
		if (source.recoveryComplete) return _completeEmpty(childId, positionId);
		if (address(source.custody) == address(0)) return false;
		ISecurityPool parentPool = source.custody.pool();
		SystemState state = parentPool.systemState();
		if (state == SystemState.Operational) {
			if (parentPool.isEscalationResolved()) {
				_recoverPosition(contextId, positionId);
				if (readPosition(contextId, positionId).recoveryComplete) return _completeEmpty(childId, positionId);
				return false;
			}
			ISecurityPoolForker(parentPool.securityPoolForker()).initiateSecurityPoolFork(parentPool);
		} else if (state != SystemState.PoolForked) return false;
		require(shares <= source.unmigratedShares, 'Shared ownership exceeds backing');
		ISecurityPool childPool = portfolio.getPool(parentPool.questionId(), child.universeId);
		SecurityPoolPortfolioPosition custody = helpers.createPosition(childPool, quoteHelper, parentPool, address(source.custody));
		positionSourcePools[address(custody)] = address(childPool);
		positions[childId][positionId] = Position(custody, shares, shares, false);
		processedPositions[childId][positionId] = true;
		if (contextId == 0) portfolio.releaseForkPosition(positionId, address(custody), shares, msg.sender);
		else {
			_collect(contextId, positionId);
			positions[contextId][positionId].unmigratedShares -= shares;
			source.custody.release(address(custody), shares, source.unmigratedShares);
		}
		custody.migrateIncoming(outcomeIndex);
		// Split-time parent fee fractions and parent-token donations belong to the source owners.
		_collect(contextId, positionId);
		if (contextId == 0) portfolio.finalizeForkPosition(positionId);
		else if (positions[contextId][positionId].unmigratedShares == 0) {
			positions[contextId][positionId].recoveryComplete = true;
			contexts[contextId].ledger.markPositionComplete(positionId);
		}
		emit SharedForkMigrated(contextId, positionId, childId, custody, shares);
		return true;
	}

	function _completeEmpty(uint256 contextId, uint256 positionId) private returns (bool) {
		processedPositions[contextId][positionId] = true;
		positions[contextId][positionId].recoveryComplete = true;
		contexts[contextId].ledger.markPositionComplete(positionId);
		return true;
	}

	function _collect(uint256 contextId, uint256 positionId) private {
		if (contextId == 0) {
			portfolio.collectForkPosition(positionId);
			return;
		}
		Position storage position = positions[contextId][positionId];
		(uint256 rep, uint256 fees) = position.custody.collect();
		_credit(contextId, positionId, rep, fees);
	}

	function _credit(uint256 contextId, uint256 positionId, uint256 rep, uint256 fees) private {
		if (rep == 0 && fees == 0) return;
		recoveredRep[contextId] += rep;
		recoveredFees[contextId] += fees;
		contexts[contextId].ledger.credit(positionId, rep, fees, positions[contextId][positionId].remainingShares);
	}

	function _recoverPosition(uint256 contextId, uint256 positionId) private returns (bool progressed) {
		Position memory previous = readPosition(contextId, positionId);
		if (previous.recoveryComplete) return false;
		if (contextId == 0) {
			if (previous.remainingShares == 0) return false;
			portfolio.recoverForkPosition(positionId, msg.sender);
			return readPosition(contextId, positionId).recoveryComplete;
		}
		if (address(previous.custody) == address(0)) return false;
		(uint256 rep, uint256 fees, bool complete) = previous.custody.recover();
		_credit(contextId, positionId, rep, fees);
		positions[contextId][positionId].recoveryComplete = complete;
		if (complete) contexts[contextId].ledger.markPositionComplete(positionId);
		emit ForkPositionRecovered(contextId, positionId, rep, fees, complete);
		return complete || rep > 0 || fees > 0;
	}

	/// @notice Process selected incoming allocations and collect this branch's cash across owner intervals.
	/// Progress without cash is valid: native child backing may still await its migration/auction phase.
	function claimForkRecovered(uint256 contextId, uint256[] calldata intervalIds, uint256[] calldata positionIds) external nonReentrant {
		require(contextId != 0, 'Use origin recovery collection');
		Context memory context = getContext(contextId);
		bool progressed;
		for (uint256 index; index < positionIds.length; index++) {
			uint256 positionId = positionIds[index];
			if (!processedPositions[contextId][positionId]) {
				if (_processForkPosition(context.parentContextId, positionId, context.outcomeIndex)) progressed = true;
			}
			if (_recoverPosition(contextId, positionId)) progressed = true;
		}
		(uint256 rep, uint256 fees, bool retired) = context.ledger.claim(msg.sender, intervalIds);
		recoveredRep[contextId] -= rep;
		recoveredFees[contextId] -= fees;
		require(progressed || rep > 0 || fees > 0 || retired, 'No fork recovery progress');
		if (rep > 0) context.repToken.safeTransfer(msg.sender, rep);
		_sendEth(msg.sender, fees);
		emit ForkRecoveryCollected(contextId, msg.sender, rep, fees);
	}

	function claimPosition(uint256 contextId, uint256 positionId, uint256 intervalId) external nonReentrant {
		if (contextId == 0) portfolio.claimForkPosition(msg.sender, positionId, intervalId, false, 0);
		else _claimPosition(contextId, positionId, intervalId, false, 0);
	}

	function claimPositionAndMigrate(uint256 contextId, uint256 positionId, uint256 intervalId, uint256 outcomeIndex) external nonReentrant {
		if (contextId == 0) portfolio.claimForkPosition(msg.sender, positionId, intervalId, true, outcomeIndex);
		else _claimPosition(contextId, positionId, intervalId, true, outcomeIndex);
	}

	function _claimPosition(uint256 contextId, uint256 positionId, uint256 intervalId, bool migrate, uint256 outcomeIndex) private {
		require(!choices[contextId][msg.sender][intervalId].selected, 'Interval has shared fork choice');
		Position memory source = readPosition(contextId, positionId);
		require(address(source.custody) != address(0) && !source.recoveryComplete, 'No active fork position');
		ISecurityPool parent = source.custody.pool();
		SecurityPoolPortfolioVault vault = portfolio.createForkVault(msg.sender);
		if (migrate) {
			require(parent.systemState() == SystemState.PoolForked, 'Question pool not forked');
			(uint256 units, uint256 commitment, , ) = parent.securityVaults(address(vault));
			require(units == 0 && commitment == 0 && parent.vaultBadDebtAttoEth(address(vault)) == 0, 'Migrate existing question position first');
			require(address(parent.escalationGame()) == address(0) || parent.escalationGame().disputeStakedRepByVaultAttoRep(address(vault)) == 0, 'Migrate existing dispute position first');
		}
		_collect(contextId, positionId);
		uint256 shares = contexts[contextId].ledger.excludePosition(msg.sender, intervalId, positionId);
		Position storage position = positions[contextId][positionId];
		position.remainingShares -= shares;
		position.unmigratedShares -= shares;
		if (position.unmigratedShares == 0) position.recoveryComplete = true;
		source.custody.release(address(vault), shares, source.unmigratedShares);
		if (migrate) vault.migrateClaimedPosition(parent, outcomeIndex);
		if (position.unmigratedShares == 0) {
			if (position.remainingShares > 0) _collect(contextId, positionId);
			contexts[contextId].ledger.markPositionComplete(positionId);
		}
		emit ForkPositionClaimed(contextId, positionId, msg.sender, vault, shares);
	}

	function _sendEth(address recipient, uint256 amount) private {
		if (amount == 0) return;
		(bool sent, ) = payable(recipient).call{value: amount}('');
		require(sent, 'Fork fee transfer failed');
	}

	receive() external payable {}
}
