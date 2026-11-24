// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CheckedCast } from '../CheckedCast.sol';

import { SecurityPoolCreationCodeDeployer } from './SecurityPoolCreationCode.sol';

import { Zoltar } from '../Zoltar.sol';
import { Collateral } from '../Collateral.sol';
import { ICollateralConfig } from './interfaces/ICollateralConfig.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolSettlement } from './SecurityPoolSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { SecurityPoolQuestionMap } from './SecurityPoolQuestionMap.sol';
import { SecurityPoolRepairAuction } from './SecurityPoolRepairAuction.sol';
import { SecurityPoolUniformPriceRepairAuction } from './SecurityPoolUniformPriceRepairAuction.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { Constants } from '../Constants.sol';

interface ISecurityPoolForkRoot {
	function originUniverseId() external view returns (uint248);
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function settlement() external view returns (SecurityPoolSettlement);
	function reporters() external view returns (SecurityPoolReporterLedger);
	function services() external view returns (address);
	function forkSecurityPoolTime(uint248 universeId) external view returns (uint48);
	function prepareForkChild(uint248 parent, uint256 outcome) external returns (SecurityPoolCapitalLedger);
	function activateForkChild(uint248 child) external;
	function getQuestionLedger(uint256 questionId, uint248 universeId) external view returns (IQuestionLedger);
	function minimumCommitmentAttoEth() external view returns (uint256);
	function repairAuctionDeployer() external view returns (ISecurityPoolCollateralRepairAuctionDeployer);
}

interface ISecurityPoolCollateralRepairAuctionDeployer {
	function create(address authority, address securityPool, uint248 child, uint256 close, uint256 inventory, uint256 shortfall) external returns (address);
}

interface ISecurityPoolForkServices {
	function freezePremiumUniverse(uint248 source) external;
	function onPremiumChoice(uint248 source, uint248 child, uint256 branchChosenK, uint256 totalSourceK) external;
	function createPremiumChild(uint248 source, uint248 child) external;
	function checkpointPreparationPremium(uint248 child) external;
	function recoverPremiumCash(uint248 source, uint256 questionId, uint256 shares, address recipient) external returns (uint256);
}

interface ISecurityPoolRecoveryShares {
	function consumeSecurityPoolRecoveryCompleteSets(uint248 sourceUniverse, address holder, uint256 amount) external returns (uint256);
}

/// @notice One owner choice and one shared migration per actual native fork.
/// @dev No operation enumerates questions, owners, bidders or previous forks.
/// Principal outside pledged positions and old vested income remain in the parent.
contract SecurityPoolForkCoordinator {
	using SafeERC20Ops for IERC20;
	using SecurityPoolQuestionMap for SecurityPoolQuestionMap.Store;

	ISecurityPoolForkRoot public immutable securityPool;
	Zoltar public immutable zoltar;
	bool private entered;
	/// @dev Security pool time freezes at a source fork. Each child inherits that time,
	/// then advances only when that branch becomes operational. All inherited games
	/// share that activation anchor. Native fee deadlines still use blockchain time.
	struct UniverseClock {
		uint48 securityPoolTimeAnchor;
		uint48 wallAnchor;
		bool registered;
		bool ready;
	}
	mapping(uint248 => UniverseClock) public clocks;

	struct Fork {
		uint256 backing;
		uint256 commitment;
		uint256 cash;
		uint256 units;
		uint256 recoveryAttoRep;
		uint256 assignedCash;
		uint256 neutralCash;
		uint256 recoveredUnits;
		bool frozen;
		bool recoveryFunded;
		bool migrationPrepared;
	}
	struct Branch {
		SecurityPoolRepairAuction repairAuction;
		uint64 fixedRoot;
		uint248 parent;
		uint256 outcome;
		uint256 chosenBacking;
		uint256 chosenCommitment;
		uint256 parentCash;
		uint256 recoveryAttoRep;
		// Prepared: child custody and inherited outcomes exist. Started: choice
		// window closed and backing migrated. Ready: settlement/import activated.
		// These flags remain independent of the universe clock's readiness.
		bool prepared;
		bool started;
		bool ready;
	}
	function repairAuctions(uint248 universeId) external view returns (SecurityPoolRepairAuction) {
		return branchStates[universeId].repairAuction;
	}
	function branches(uint248 universeId)
		external
		view
		returns (
			uint248 parent,
			uint256 outcome,
			uint256 chosenBacking,
			uint256 chosenCommitment,
			uint256 parentCash,
			uint256 recoveryAttoRep,
			bool prepared,
			bool started,
			bool ready
		)
	{
		Branch storage branch = branchStates[universeId];
		return (
			branch.parent,
			branch.outcome,
			branch.chosenBacking,
			branch.chosenCommitment,
			branch.parentCash,
			branch.recoveryAttoRep,
			branch.prepared,
			branch.started,
			branch.ready
		);
	}
	struct Choice {
		uint256 outcome;
		bool recorded;
	}
	mapping(uint248 => Fork) public forks;
	mapping(uint248 => Branch) private branchStates;
	mapping(uint248 => mapping(address => Choice)) public choices;
	mapping(uint248 => mapping(uint256 => uint256)) public recoveredQuestionShares;
	SecurityPoolQuestionMap.Store private fixedTree;

	event ForkFrozen(uint248 indexed universeId, uint256 backing, uint256 cash, uint256 units, uint256 recoveryAttoRep);
	event BranchChosen(uint248 indexed universeId, address indexed owner, uint256 indexed outcome, uint256 backing, uint256 commitment);
	event BranchStarted(uint248 indexed universeId, uint256 parentCash, uint256 recoveryAttoRep);
	event BranchActivated(uint248 indexed universeId, uint256 fundedCash, uint256 recoveryAttoRep);
	event NeutralCashRecovered(uint248 indexed universeId, uint256 indexed questionId, address indexed owner, uint256 shares, uint256 cash);

	constructor(address authority, Zoltar protocol) {
		require(authority != address(0) && address(protocol).code.length != 0, 'Fork dependencies missing');
		securityPool = ISecurityPoolForkRoot(authority);
		zoltar = protocol;
	}
	modifier nonReentrant() {
		require(!entered, 'Fork operation active');
		entered = true;
		_;
		entered = false;
	}

	function initialize(uint248 origin) external {
		require(msg.sender == address(securityPool) && !clocks[origin].registered, 'Fork clock initialization unavailable');
		clocks[origin] = UniverseClock({securityPoolTimeAnchor: 0, wallAnchor: 0, registered: true, ready: false});
	}
	function activateOrigin(uint248 origin) external {
		require(msg.sender == address(securityPool) && clocks[origin].registered && !branchStates[origin].prepared, 'Origin activation unavailable');
		clocks[origin].ready = true;
	}
	function isReady(uint248 universeId) external view returns (bool) {
		return clocks[universeId].ready;
	}
	/// @notice Preparation reports stop at the fixed closing time. The last
	/// accepted observation stays unchanged until branch activation, so delaying
	/// finalization cannot choose a different auction price or freshness cutoff.
	function isPriceReportingOpen(uint248 universeId) external view returns (bool) {
		if (zoltar.getForkTime(universeId) != 0) return false;
		if (clocks[universeId].ready) return true;
		Branch storage branch = branchStates[universeId];
		return branch.started && block.timestamp < zoltar.getForkRecapitalizationDeadline(branch.parent);
	}
	/// @notice Reports reserve the maximum winning liability before bids begin.
	/// These budgets remain fixed until activation, including a delayed closing.
	function repairAuctionExposure(uint248 universeId) external view returns (uint256 commitment, uint256 rep) {
		Branch storage branch = branchStates[universeId];
		if (!branch.started || branch.ready) return (0, 0);
		SecurityPoolRepairAuction repairAuction = branch.repairAuction;
		if (address(repairAuction) == address(0)) return (branch.chosenCommitment, 0);
		return (
			branch.chosenCommitment + repairAuction.targetLots() * repairAuction.lotAttoEth(),
			repairAuction.inventoryAttoRep()
		);
	}
	/// @notice The security pool clock used for settlement and finality, adjusted for fork pauses.
	function securityPoolTime(uint248 universeId) public view returns (uint48) {
		uint256 wall = zoltar.getForkTime(universeId);
		return _securityPoolTimeAt(universeId, wall == 0 ? block.timestamp : Math.min(wall, block.timestamp));
	}
	function _securityPoolTimeAt(uint248 universeId, uint256 wall) private view returns (uint48) {
		UniverseClock memory clock = clocks[universeId];
		require(clock.registered, 'Unknown security pool universe');
		uint256 securityPoolTimestamp =
			clock.securityPoolTimeAnchor +
				(
					(clock.ready || universeId == securityPool.originUniverseId()) && wall > clock.wallAnchor
						? wall - clock.wallAnchor
						: 0
				);
		require(securityPoolTimestamp <= type(uint48).max, 'Security pool clock exhausted');
		return uint48(securityPoolTimestamp);
	}
	function forkSecurityPoolTime(uint248 universeId) external view returns (uint48) {
		uint256 forkTime = zoltar.getForkTime(universeId);
		require(forkTime != 0, 'Universe has not forked');
		return _securityPoolTimeAt(universeId, forkTime);
	}
	function securityPoolTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48) {
		return _securityPoolTimeAt(universeId, timestamp);
	}
	function nativeTimeForSecurityPoolTime(uint248 universeId, uint48 timestamp) external view returns (uint48) {
		UniverseClock memory clock = clocks[universeId];
		require(clock.registered && timestamp >= clock.securityPoolTimeAnchor, 'Security pool time precedes universe');
		uint256 wall = uint256(clock.wallAnchor) + timestamp - clock.securityPoolTimeAnchor;
		require(wall <= type(uint48).max, 'Native clock exhausted');
		return uint48(wall);
	}

	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256) {
		uint256 id = fixedTree.get(branchStates[universeId].fixedRoot, questionId);
		return id == 0 ? (false, uint256(0)) : (true, id - 1);
	}

	function freeze(uint248 universeId) external nonReentrant {
		_freeze(universeId);
	}
	function _freeze(uint248 universeId) private {
		Fork storage fork = forks[universeId];
		if (fork.frozen) return;
		require(zoltar.getForkTime(universeId) != 0, 'Native fork missing');
		require(clocks[universeId].ready, 'Prepare source branch first');
		SecurityPoolCapitalLedger capital = securityPool.capitalLedger(universeId);
		capital.freeze();
		(fork.cash, fork.units, ) = securityPool.settlement().sealUniverse(universeId, securityPool.forkSecurityPoolTime(universeId));
		capital.synchronizeDemand(fork.cash);
		ISecurityPoolForkServices(securityPool.services()).freezePremiumUniverse(universeId);
		securityPool.reporters().freezeFork(universeId);
		fork.backing = capital.frozenBackingAttoRep();
		fork.commitment = capital.frozenCommitmentAttoEth();
		fork.recoveryAttoRep = securityPool.settlement().availableForkRecoveryAttoRep(universeId);
		fork.frozen = true;
		// Capital.freeze checkpoints every pre-fork earned fee before weights freeze.
		emit ForkFrozen(universeId, fork.backing, fork.cash, fork.units, fork.recoveryAttoRep);
	}

	function choose(uint248 source, uint256 outcome) external nonReentrant {
		_freeze(source);
		require(block.timestamp < zoltar.getForkChoiceDeadline(source), 'Fork choice window closed');
		require(!choices[source][msg.sender].recorded, 'Fork choice already recorded');
		uint248 child = _prepare(source, outcome);
		SecurityPoolCapitalLedger parentCapital = securityPool.capitalLedger(source);
		(SecurityPoolCapitalLedger.ChoicePosition memory position, uint256 target) = parentCapital.exportChoice(msg.sender);
		uint256 rep = position.rep;
		uint256 commitment = position.commitment;
		require(rep != 0, 'No pledged fork principal');
		Fork storage fork = forks[source];
		Branch storage branch = branchStates[child];
		uint256 previousCash = branch.parentCash;
		branch.chosenBacking += rep;
		branch.chosenCommitment += commitment;
		// Cash follows accepted liability. Excess personal collateral must not
		// move more ETH into a branch than its owners committed to underwrite.
		require(fork.commitment != 0, 'Fork commitment missing');
		branch.parentCash = Math.mulDiv(fork.cash, branch.chosenCommitment, fork.commitment);
		ISecurityPoolForkServices(securityPool.services()).onPremiumChoice(source, child, branch.chosenCommitment, fork.commitment);
		fork.assignedCash += branch.parentCash - previousCash;
		choices[source][msg.sender] = Choice(outcome, true);
		securityPool.capitalLedger(child).importChoice(msg.sender, position, target);
		emit BranchChosen(source, msg.sender, outcome, rep, commitment);
	}

	function _prepare(uint248 parent, uint256 outcome) private returns (uint248 child) {
		child = zoltar.getChildUniverseId(parent, outcome);
		Branch storage branch = branchStates[child];
		if (branch.prepared) return child;
		uint256 anchor = zoltar.getForkRecapitalizationDeadline(parent);
		require(anchor <= type(uint48).max, 'Fork clock exhausted');
		clocks[child] = UniverseClock({securityPoolTimeAnchor: _securityPoolTimeAt(parent, zoltar.getForkTime(parent)), wallAnchor: uint48(anchor), registered: true, ready: false});
		securityPool.prepareForkChild(parent, outcome);
		branch.parent = parent;
		branch.outcome = outcome;
		branch.prepared = true;
		uint64 root = branchStates[parent].fixedRoot;
		(, uint256 questionId, , , ) = zoltar.universes(parent);
		// A later fork cannot overwrite a question outcome already fixed in an ancestor.
		if (fixedTree.get(root, questionId) == 0) {
			// Valid scalar outcomes have reserved zero bits below bit 255; categorical
			// outcomes are bounded by the label count. Neither can be uint256.max.
			root = fixedTree.set(root, questionId, outcome + 1);
		}
		branch.fixedRoot = root;
	}

	/// @notice Prepare custody separately from migration and auction deployment.
	/// This fixed setup step keeps a branch with no choosing owners deployable
	/// within the transaction gas limit, without processing any owner or bid list.
	function prepareBranch(uint248 parent, uint256 outcome) external nonReentrant returns (uint248 child) {
		_freeze(parent);
		return _prepare(parent, outcome);
	}
	function startBranch(uint248 parent, uint256 outcome) external nonReentrant returns (uint248 child) {
		_freeze(parent);
		child = _prepare(parent, outcome);
		_start(child);
	}
	function _start(uint248 child) private {
		Branch storage branch = branchStates[child];
		if (branch.started) return;
		require(block.timestamp >= zoltar.getForkChoiceDeadline(branch.parent), 'Fork choices still open');
		Fork storage fork = forks[branch.parent];
		branch.started = true;
		SecurityPoolCapitalLedger sourceCapital = securityPool.capitalLedger(branch.parent);
		SecurityPoolCapitalLedger childCapital = securityPool.capitalLedger(child);
		uint256 migratingPrincipalAttoRep = fork.backing + fork.recoveryAttoRep;
		_prepareSourceMigration(branch.parent, fork, sourceCapital, migratingPrincipalAttoRep);
		if (migratingPrincipalAttoRep != 0) {
			uint256[] memory outcomes = new uint256[](1);
			outcomes[0] = branch.outcome;
			zoltar.splitMigrationRep(branch.parent, migratingPrincipalAttoRep, outcomes);
		}
		IERC20 token = IERC20(address(zoltar.getRepToken(child)));
		if (branch.chosenBacking != 0) token.safeTransfer(address(childCapital), branch.chosenBacking);
		securityPool.reporters().createChild(branch.parent, branch.outcome);
		branch.recoveryAttoRep = migratingPrincipalAttoRep - branch.chosenBacking;
		if (fork.units == 0 && branch.recoveryAttoRep != 0) {
			zoltar.burnRep(child, branch.recoveryAttoRep);
			branch.recoveryAttoRep = 0;
		}
		_createBranchRepairAuctionIfNeeded(child, branch, fork, token);
		ISecurityPoolForkServices(securityPool.services()).createPremiumChild(branch.parent, child);
		emit BranchStarted(child, branch.parentCash, branch.recoveryAttoRep);
	}

	function _prepareSourceMigration(uint248 sourceUniverseId, Fork storage fork, SecurityPoolCapitalLedger sourceCapital, uint256 migratingPrincipalAttoRep) private {
		if (!fork.migrationPrepared) {
			fork.migrationPrepared = true;
			sourceCapital.releaseForkBacking();
			uint256 releasedRecoveryAttoRep = securityPool.settlement().withdrawForkRecoveryRep(sourceUniverseId);
			require(releasedRecoveryAttoRep == fork.recoveryAttoRep, 'Fork recovery REP mismatch');
			if (migratingPrincipalAttoRep != 0) {
				IERC20 sourceToken = IERC20(address(zoltar.getRepToken(sourceUniverseId)));
				if (address(sourceToken) == address(zoltar.genesisReputationToken()))
					sourceToken.safeApprove(address(zoltar), migratingPrincipalAttoRep);
				zoltar.addRepToMigrationBalance(sourceUniverseId, migratingPrincipalAttoRep);
			}
		}
	}
	function _createBranchRepairAuctionIfNeeded(uint248 child, Branch storage branch, Fork storage fork, IERC20 token) private {
		uint256 freshInventoryAttoRep = fork.backing - branch.chosenBacking;
		SecurityPoolSettlement settlement = securityPool.settlement();
		uint256 targetCash = settlement.ledger().requiredForkCash(settlement.bookIds(branch.parent));
		uint256 settlementShortfallAttoEth = targetCash - branch.parentCash;
		if (
			fork.units != 0 &&
			freshInventoryAttoRep != 0 &&
			settlementShortfallAttoEth >= securityPool.minimumCommitmentAttoEth()
		) {
			SecurityPoolRepairAuction repairAuction = SecurityPoolRepairAuction(securityPool.repairAuctionDeployer().create(address(this), address(securityPool), child, zoltar.getForkRecapitalizationDeadline(branch.parent), freshInventoryAttoRep, settlementShortfallAttoEth));
			branch.repairAuction = repairAuction;
			token.safeTransfer(address(repairAuction), freshInventoryAttoRep);
		}
	}

	function finalizeBranch(uint248 child) external nonReentrant {
		_finalize(child);
	}
	function _finalize(uint248 child) private {
		Branch storage branch = branchStates[child];
		require(branch.prepared, 'Fork branch unknown');
		if (branch.ready) return;
		_start(child);
		// The earliest activation date remains fixed even when bids or quotes are missing.
		require(block.timestamp >= zoltar.getForkRecapitalizationDeadline(branch.parent), 'Fork activation window still open');
		uint256 raisedAttoEth = _settleBranchRepairAuction(child, branch);
		// No inherited reporting time elapses while the branch is in preparation.
		clocks[child].wallAnchor = CheckedCast.toUint48(block.timestamp);
		_initializeChildSettlement(child, branch, raisedAttoEth);
		ISecurityPoolForkServices(securityPool.services()).checkpointPreparationPremium(child);
		securityPool.capitalLedger(child).finishForkImport(branch.parentCash + raisedAttoEth);
		branch.ready = true;
		clocks[child].ready = true;
		securityPool.activateForkChild(child);
		emit BranchActivated(child, branch.parentCash + raisedAttoEth, branch.recoveryAttoRep);
	}

	function _settleBranchRepairAuction(uint248 child, Branch storage branch) private returns (uint256 raisedAttoEth) {
		SecurityPoolRepairAuction repairAuction = branch.repairAuction;
		if (address(repairAuction) != address(0)) {
			SecurityPoolUniformPriceRepairAuction.Clearing memory result = repairAuction.finalize();
			raisedAttoEth = result.raisedAttoEth;
			branch.recoveryAttoRep -= result.soldAttoRep;
			if (result.filledLots != 0)
				securityPool.capitalLedger(child).installRepairAuctionCohort(address(repairAuction), result.filledLots, result.attoRepPerLot, repairAuction.lotAttoEth());
		}
	}
	function _initializeChildSettlement(uint248 child, Branch storage branch, uint256 raisedAttoEth) private {
		SecurityPoolSettlement settlement = securityPool.settlement();
		IERC20 token = IERC20(address(zoltar.getRepToken(child)));
		if (branch.recoveryAttoRep != 0) token.safeApprove(address(settlement), branch.recoveryAttoRep);
		ICollateralConfig(address(securityPool)).collateralToken().safeApprove(address(settlement), raisedAttoEth);
		settlement.createChildUniverse(branch.parent, child, branch.parentCash, token, branch.recoveryAttoRep, raisedAttoEth);
		uint256 nativeForkTime = zoltar.getForkTime(child);
		settlement.setFeeClock(child, CheckedCast.toUint48(nativeForkTime == 0 ? block.timestamp : nativeForkTime));
		(, uint256 forkQuestion, , , ) = zoltar.universes(branch.parent);
		settlement.fixInheritedQuestionFinality(child, forkQuestion, clocks[child].securityPoolTimeAnchor + Constants.FORK_RESPONSE_DELAY);
	}

	/// @notice Resolve only this actual fork, never recursively walk ancestors.
	function ensureReady(uint248 child) external nonReentrant {
		if (child == securityPool.originUniverseId()) return;
		if (!branchStates[child].prepared) {
			(, , uint256 outcome, , uint248 parent) = zoltar.universes(child);
			require(address(zoltar.getRepToken(child)) != address(0), 'Native child not deployed');
			_freeze(parent);
			require(_prepare(parent, outcome) == child, 'Wrong native child');
		}
		_finalize(child);
	}

	/// @notice Unassigned source cash requires complete sets, independently of
	/// every child token mint. Spending this right never burns branch entitlements.
	function recoverUnchosenCash(uint248 source, uint256 questionId, uint256 shares) external nonReentrant returns (uint256 cash) {
		_freeze(source);
		require(block.timestamp >= zoltar.getForkChoiceDeadline(source), 'Fork choices still open');
		SecurityPoolSettlementBook.Question memory question = _recoveryQuestion(source, questionId);
		IQuestionLedger pool = securityPool.getQuestionLedger(questionId, source);
		ISecurityPoolRecoveryShares(address(pool.shareToken())).consumeSecurityPoolRecoveryCompleteSets(source, msg.sender, shares);
		cash = _recordRecovery(source, questionId, question, shares);
		ISecurityPoolForkServices(securityPool.services()).recoverPremiumCash(source, questionId, shares, msg.sender);
		if (cash != 0) {
			Collateral.send(ICollateralConfig(address(securityPool)).collateralToken(), msg.sender, cash);
		}
		emit NeutralCashRecovered(source, questionId, msg.sender, shares, cash);
	}

	function _recoveryQuestion(uint248 source, uint256 questionId) private returns (SecurityPoolSettlementBook.Question memory question) {
		Fork storage fork = forks[source];
		SecurityPoolSettlement settlement = securityPool.settlement();
		if (!fork.recoveryFunded) {
			fork.recoveryFunded = true;
			fork.neutralCash = fork.cash - fork.assignedCash;
			if (fork.neutralCash != 0) settlement.withdrawForkRecoveryCash(source, fork.neutralCash);
		}
		SecurityPoolSettlementBook ledger = settlement.ledger();
		uint64 bookId = settlement.bookIds(source);
		(question, ) = ledger.scaledQuestion(bookId, questionId);
		require(ledger.hasLiveForkRecoveryRight(bookId, questionId, 0), 'No live source recovery right');
	}

	function _recordRecovery(uint248 source, uint256 questionId, SecurityPoolSettlementBook.Question memory question, uint256 shares) private returns (uint256 cash) {
		Fork storage fork = forks[source];
		uint256 beforeShares = recoveredQuestionShares[source][questionId];
		uint256 afterShares = beforeShares + shares;
		require(afterShares <= question.outcomeSupplyAttoShares, 'Recovery exceeds source supply');
		recoveredQuestionShares[source][questionId] = afterShares;
		// Differences of cumulative floors conserve every unit across partial claims;
		// flooring each claim independently would leave rounding dust unallocated.
		uint256 units =
			Math.mulDiv(question.units, afterShares, question.outcomeSupplyAttoShares) -
				Math.mulDiv(question.units, beforeShares, question.outcomeSupplyAttoShares);
		// Fully accrued holding fees can exhaust ETH units while the separate
		// prepaid resolution budget still belongs to these authenticated shares.
		// Apply the same cumulative allocation to the fixed neutral cash basket.
		if (fork.units != 0)
			cash =
				Math.mulDiv(fork.neutralCash, fork.recoveredUnits + units, fork.units) -
				Math.mulDiv(fork.neutralCash, fork.recoveredUnits, fork.units);
		fork.recoveredUnits += units;
	}
}

contract SecurityPoolForkCoordinatorDeployer is SecurityPoolCreationCodeDeployer {
	constructor() SecurityPoolCreationCodeDeployer(type(SecurityPoolForkCoordinator).creationCode) {}
	function create(address authority, Zoltar zoltar) external returns (address) {
		return _deploy(abi.encode(authority, zoltar));
	}
}
