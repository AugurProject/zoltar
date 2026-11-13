// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCreationCodeDeployer } from './SecurityPoolCreationCode.sol';

import { Zoltar } from '../Zoltar.sol';
import { Collateral } from '../Collateral.sol';
import { ICollateralConfig } from './interfaces/ICollateralConfig.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { SecurityPoolPersistentMap } from './SecurityPoolPersistentMap.sol';
import { SecurityPoolPortfolioAuction } from './SecurityPoolPortfolioAuction.sol';
import { SecurityPoolUniformPriceAuction } from './SecurityPoolUniformPriceAuction.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface IPortfolioForkRoot {
	function originUniverseId() external view returns (uint248);
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function settlement() external view returns (SecurityPoolPortfolioSettlement);
	function reporters() external view returns (SecurityPoolReporterLedger);
	function services() external view returns (address);
	function portfolioTime(uint248 universeId) external view returns (uint48);
	function forkPortfolioTime(uint248 universeId) external view returns (uint48);
	function clocks(uint248 universeId) external view returns (uint48, uint48, bool, bool);
	function prepareForkChild(uint248 parent, uint256 outcome) external returns (SecurityPoolCapitalLedger);
	function activateForkChild(uint248 child) external;
	function creditForkFees(uint248 universeId, uint256 amount) external;
	function getPool(uint256 questionId, uint248 universeId) external view returns (ISecurityPool);
	function minimumCommitmentAttoEth() external view returns (uint256);
	function auctionDeployer() external view returns (IPortfolioCollateralRepairAuctionDeployer);
}

interface IPortfolioCollateralRepairAuctionDeployer {
	function create(address authority, address portfolio, uint248 child, uint256 close, uint256 inventory, uint256 shortfall) external returns (address);
}

interface IPortfolioForkServices {
	function freezePremiumUniverse(uint248 source) external;
	function onPremiumChoice(uint248 source, uint248 child, uint256 branchChosenK, uint256 totalSourceK) external;
	function createPremiumChild(uint248 source, uint248 child) external;
	function checkpointPreparationPremium(uint248 child) external;
	function recoverPremiumCash(uint248 source, uint256 questionId, uint256 shares, address recipient) external returns (uint256);
}

interface IPortfolioRecoveryShares {
	function consumePortfolioRecoveryCompleteSets(uint248 sourceUniverse, address holder, uint256 amount) external returns (uint256);
}

/// @notice One owner choice and one shared migration per actual native fork.
/// @dev No operation enumerates questions, owners, bidders or previous forks.
/// Principal outside pledged positions and old vested income remain in the parent.
contract SecurityPoolPortfolioForkCoordinator {
	using SafeERC20Ops for IERC20;
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;

	IPortfolioForkRoot public immutable portfolio;
	Zoltar public immutable zoltar;
	bool private entered;
	/// @dev Portfolio time freezes at a source fork. Each child inherits that time,
	/// then advances from its fixed recapitalization deadline, independent of when
	/// activation is called. Native fee deadlines continue to use blockchain time.
	struct UniverseClock {
		uint48 portfolioTimeAnchor;
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
		SecurityPoolPortfolioAuction auction;
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
	function auctions(uint248 universeId) external view returns (SecurityPoolPortfolioAuction) {
		return branchStates[universeId].auction;
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
	struct FixedOutcome {
		uint256 outcome;
	}
	mapping(uint248 => Fork) public forks;
	mapping(uint248 => Branch) private branchStates;
	mapping(uint248 => mapping(address => Choice)) public choices;
	mapping(uint248 => mapping(uint256 => uint256)) public recoveredQuestionShares;
	SecurityPoolPersistentMap.Store private fixedTree;
	FixedOutcome[] private fixedOutcomes;

	event ForkFrozen(uint248 indexed universeId, uint256 backing, uint256 cash, uint256 units, uint256 recoveryAttoRep);
	event BranchChosen(uint248 indexed universeId, address indexed owner, uint256 indexed outcome, uint256 backing, uint256 commitment);
	event BranchStarted(uint248 indexed universeId, uint256 parentCash, uint256 recoveryAttoRep);
	event BranchActivated(uint248 indexed universeId, uint256 fundedCash, uint256 recoveryAttoRep);
	event NeutralCashRecovered(uint248 indexed universeId, uint256 indexed questionId, address indexed owner, uint256 shares, uint256 cash);

	constructor(address authority, Zoltar protocol) {
		require(authority != address(0) && address(protocol).code.length != 0, 'Fork dependencies missing');
		portfolio = IPortfolioForkRoot(authority);
		zoltar = protocol;
		fixedOutcomes.push(FixedOutcome(0));
	}
	modifier nonReentrant() {
		require(!entered, 'Fork operation active');
		entered = true;
		_;
		entered = false;
	}
	receive() external payable {}

	function initialize(uint248 origin) external {
		require(msg.sender == address(portfolio) && !clocks[origin].registered, 'Fork clock initialization unavailable');
		clocks[origin] = UniverseClock(0, 0, true, false);
	}
	function activateOrigin(uint248 origin) external {
		require(msg.sender == address(portfolio) && clocks[origin].registered && !branchStates[origin].prepared, 'Origin activation unavailable');
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
	function auctionExposure(uint248 universeId) external view returns (uint256 commitment, uint256 rep) {
		Branch storage branch = branchStates[universeId];
		if (!branch.started || branch.ready) return (0, 0);
		SecurityPoolPortfolioAuction auction = branch.auction;
		if (address(auction) == address(0)) return (branch.chosenCommitment, 0);
		return (branch.chosenCommitment + auction.targetLots() * auction.lotAttoEth(), auction.inventoryAttoRep());
	}
	/// @notice The portfolio clock used for settlement and finality, adjusted for fork pauses.
	function portfolioTime(uint248 universeId) public view returns (uint48) {
		uint256 wall = zoltar.getForkTime(universeId);
		return _portfolioTimeAt(universeId, wall == 0 ? block.timestamp : Math.min(wall, block.timestamp));
	}
	function _portfolioTimeAt(uint248 universeId, uint256 wall) private view returns (uint48) {
		UniverseClock memory clock = clocks[universeId];
		require(clock.registered, 'Unknown portfolio universe');
		uint256 portfolioTimestamp =
			clock.portfolioTimeAnchor + (wall > clock.wallAnchor ? wall - clock.wallAnchor : 0);
		require(portfolioTimestamp <= type(uint48).max, 'Portfolio clock exhausted');
		return uint48(portfolioTimestamp);
	}
	function forkPortfolioTime(uint248 universeId) external view returns (uint48) {
		uint256 forkTime = zoltar.getForkTime(universeId);
		require(forkTime != 0, 'Universe has not forked');
		return _portfolioTimeAt(universeId, forkTime);
	}
	function portfolioTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48) {
		return _portfolioTimeAt(universeId, timestamp);
	}
	function nativeTimeForPortfolioTime(uint248 universeId, uint48 timestamp) external view returns (uint48) {
		UniverseClock memory clock = clocks[universeId];
		require(clock.registered && timestamp >= clock.portfolioTimeAnchor, 'Portfolio time precedes universe');
		uint256 wall = uint256(clock.wallAnchor) + timestamp - clock.portfolioTimeAnchor;
		require(wall <= type(uint48).max, 'Native clock exhausted');
		return uint48(wall);
	}

	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256) {
		uint256 id = fixedTree.get(branchStates[universeId].fixedRoot, questionId);
		return id == 0 ? (false, uint256(0)) : (true, fixedOutcomes[id].outcome);
	}

	function freeze(uint248 universeId) external nonReentrant {
		_freeze(universeId);
	}
	function _freeze(uint248 universeId) private {
		Fork storage fork = forks[universeId];
		if (fork.frozen) return;
		require(zoltar.getForkTime(universeId) != 0, 'Native fork missing');
		require(clocks[universeId].ready, 'Prepare source branch first');
		SecurityPoolCapitalLedger capital = portfolio.capitalLedger(universeId);
		capital.freeze();
		(fork.cash, fork.units, ) = portfolio.settlement().sealUniverse(universeId, portfolio.forkPortfolioTime(universeId));
		IPortfolioForkServices(portfolio.services()).freezePremiumUniverse(universeId);
		portfolio.reporters().freezeFork(universeId);
		fork.backing = capital.frozenBackingAttoRep();
		fork.commitment = capital.frozenCommitmentAttoEth();
		fork.recoveryAttoRep = portfolio.settlement().availableForkRecoveryAttoRep(universeId);
		fork.frozen = true;
		// Capital.freeze checkpoints every pre-fork earned fee before weights freeze.
		emit ForkFrozen(universeId, fork.backing, fork.cash, fork.units, fork.recoveryAttoRep);
	}

	function choose(uint248 source, uint256 outcome) external nonReentrant {
		_freeze(source);
		require(block.timestamp < zoltar.getForkChoiceDeadline(source), 'Fork choice window closed');
		require(!choices[source][msg.sender].recorded, 'Fork choice already recorded');
		uint248 child = _prepare(source, outcome);
		SecurityPoolCapitalLedger parentCapital = portfolio.capitalLedger(source);
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
		IPortfolioForkServices(portfolio.services()).onPremiumChoice(source, child, branch.chosenCommitment, fork.commitment);
		fork.assignedCash += branch.parentCash - previousCash;
		choices[source][msg.sender] = Choice(outcome, true);
		portfolio.capitalLedger(child).importChoice(msg.sender, position, target);
		emit BranchChosen(source, msg.sender, outcome, rep, commitment);
	}

	function _prepare(uint248 parent, uint256 outcome) private returns (uint248 child) {
		child = zoltar.getChildUniverseId(parent, outcome);
		Branch storage branch = branchStates[child];
		if (branch.prepared) return child;
		uint256 anchor = zoltar.getForkRecapitalizationDeadline(parent);
		require(anchor <= type(uint48).max, 'Fork clock exhausted');
		clocks[child] = UniverseClock(_portfolioTimeAt(parent, zoltar.getForkTime(parent)), uint48(anchor), true, false);
		portfolio.prepareForkChild(parent, outcome);
		branch.parent = parent;
		branch.outcome = outcome;
		branch.prepared = true;
		uint64 root = branchStates[parent].fixedRoot;
		(, uint256 questionId, , , ) = zoltar.universes(parent);
		// A later fork cannot overwrite a question outcome already fixed in an ancestor.
		if (fixedTree.get(root, questionId) == 0) {
			fixedOutcomes.push(FixedOutcome(outcome));
			root = fixedTree.set(root, questionId, fixedOutcomes.length - 1, 0);
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
		SecurityPoolCapitalLedger sourceCapital = portfolio.capitalLedger(branch.parent);
		SecurityPoolCapitalLedger childCapital = portfolio.capitalLedger(child);
		uint256 migratingPrincipalAttoRep = fork.backing + fork.recoveryAttoRep;
		_prepareSourceMigration(branch.parent, fork, sourceCapital, migratingPrincipalAttoRep);
		if (migratingPrincipalAttoRep != 0) {
			uint256[] memory outcomes = new uint256[](1);
			outcomes[0] = branch.outcome;
			zoltar.splitMigrationRep(branch.parent, migratingPrincipalAttoRep, outcomes);
		}
		IERC20 token = IERC20(address(zoltar.getRepToken(child)));
		if (branch.chosenBacking != 0) token.safeTransfer(address(childCapital), branch.chosenBacking);
		portfolio.reporters().createChild(branch.parent, branch.outcome);
		branch.recoveryAttoRep = migratingPrincipalAttoRep - branch.chosenBacking;
		if (fork.units == 0 && branch.recoveryAttoRep != 0) {
			zoltar.burnRep(child, branch.recoveryAttoRep);
			branch.recoveryAttoRep = 0;
		}
		_createBranchAuctionIfNeeded(child, branch, fork, token);
		IPortfolioForkServices(portfolio.services()).createPremiumChild(branch.parent, child);
		emit BranchStarted(child, branch.parentCash, branch.recoveryAttoRep);
	}

	function _prepareSourceMigration(uint248 sourceUniverseId, Fork storage fork, SecurityPoolCapitalLedger sourceCapital, uint256 migratingPrincipalAttoRep) private {
		if (!fork.migrationPrepared) {
			fork.migrationPrepared = true;
			sourceCapital.releaseForkBacking();
			uint256 releasedRecoveryAttoRep = portfolio.settlement().withdrawForkRecoveryRep(sourceUniverseId);
			require(releasedRecoveryAttoRep == fork.recoveryAttoRep, 'Fork recovery REP mismatch');
			if (migratingPrincipalAttoRep != 0) {
				IERC20 sourceToken = IERC20(address(zoltar.getRepToken(sourceUniverseId)));
				if (address(sourceToken) == address(zoltar.genesisReputationToken()))
					sourceToken.safeApprove(address(zoltar), migratingPrincipalAttoRep);
				zoltar.addRepToMigrationBalance(sourceUniverseId, migratingPrincipalAttoRep);
			}
		}
	}
	function _createBranchAuctionIfNeeded(uint248 child, Branch storage branch, Fork storage fork, IERC20 token) private {
		uint256 freshInventoryAttoRep = fork.backing - branch.chosenBacking;
		uint256 settlementShortfallAttoEth = fork.cash - branch.parentCash;
		if (
			fork.units != 0 &&
			freshInventoryAttoRep != 0 &&
			settlementShortfallAttoEth >= portfolio.minimumCommitmentAttoEth()
		) {
			SecurityPoolPortfolioAuction auction = SecurityPoolPortfolioAuction(portfolio.auctionDeployer().create(address(this), address(portfolio), child, zoltar.getForkRecapitalizationDeadline(branch.parent), freshInventoryAttoRep, settlementShortfallAttoEth));
			branch.auction = auction;
			token.safeTransfer(address(auction), freshInventoryAttoRep);
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
		// The fixed native response schedule survives missing bids or quotes.
		require(block.timestamp >= zoltar.getForkRecapitalizationDeadline(branch.parent), 'Fork activation window still open');
		uint256 raisedAttoEth = _settleBranchAuction(child, branch);
		_initializeChildSettlement(child, branch, raisedAttoEth);
		IPortfolioForkServices(portfolio.services()).checkpointPreparationPremium(child);
		portfolio.capitalLedger(child).finishForkImport(branch.parentCash + raisedAttoEth);
		branch.ready = true;
		clocks[child].ready = true;
		portfolio.activateForkChild(child);
		emit BranchActivated(child, branch.parentCash + raisedAttoEth, branch.recoveryAttoRep);
	}

	function _settleBranchAuction(uint248 child, Branch storage branch) private returns (uint256 raisedAttoEth) {
		SecurityPoolPortfolioAuction auction = branch.auction;
		if (address(auction) != address(0)) {
			SecurityPoolUniformPriceAuction.Clearing memory result = auction.finalize();
			raisedAttoEth = result.raisedAttoEth;
			branch.recoveryAttoRep -= result.soldAttoRep;
			if (result.filledLots != 0)
				portfolio.capitalLedger(child).installAuctionCohort(address(auction), result.filledLots, result.attoRepPerLot, auction.lotAttoEth());
		}
	}
	function _initializeChildSettlement(uint248 child, Branch storage branch, uint256 raisedAttoEth) private {
		SecurityPoolPortfolioSettlement settlement = portfolio.settlement();
		IERC20 token = IERC20(address(zoltar.getRepToken(child)));
		if (branch.recoveryAttoRep != 0) token.safeApprove(address(settlement), branch.recoveryAttoRep);
		ICollateralConfig(address(portfolio)).collateralToken().safeApprove(address(settlement), raisedAttoEth);
		settlement.createChildUniverse(branch.parent, child, branch.parentCash, token, branch.recoveryAttoRep, raisedAttoEth);
		settlement.setFeeClock(child, uint48(zoltar.getForkRecapitalizationDeadline(branch.parent)));
		(, uint256 forkQuestion, , , ) = zoltar.universes(branch.parent);
		settlement.fixInheritedQuestionFinality(child, forkQuestion, clocks[child].portfolioTimeAnchor + 3 days);
	}

	/// @notice Resolve only this actual fork, never recursively walk ancestors.
	function ensureReady(uint248 child) external nonReentrant {
		if (child == portfolio.originUniverseId()) return;
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
		ISecurityPool pool = portfolio.getPool(questionId, source);
		IPortfolioRecoveryShares(address(pool.shareToken())).consumePortfolioRecoveryCompleteSets(source, msg.sender, shares);
		cash = _recordRecovery(source, questionId, question, shares);
		IPortfolioForkServices(portfolio.services()).recoverPremiumCash(source, questionId, shares, msg.sender);
		if (cash != 0) {
			Collateral.send(ICollateralConfig(address(portfolio)).collateralToken(), msg.sender, cash);
		}
		emit NeutralCashRecovered(source, questionId, msg.sender, shares, cash);
	}

	function _recoveryQuestion(uint248 source, uint256 questionId) private returns (SecurityPoolSettlementBook.Question memory question) {
		Fork storage fork = forks[source];
		SecurityPoolPortfolioSettlement settlement = portfolio.settlement();
		if (!fork.recoveryFunded) {
			fork.recoveryFunded = true;
			fork.neutralCash = fork.cash - fork.assignedCash;
			if (fork.neutralCash != 0) settlement.withdrawForkRecoveryCash(source, fork.neutralCash);
		}
		SecurityPoolSettlementBook ledger = settlement.ledger();
		uint64 bookId = settlement.bookIds(source);
		(question, ) = ledger.question(bookId, questionId);
		require(ledger.hasLiveForkRecoveryRight(bookId, questionId, 0), 'No live source recovery right');
	}

	function _recordRecovery(uint248 source, uint256 questionId, SecurityPoolSettlementBook.Question memory question, uint256 shares) private returns (uint256 cash) {
		Fork storage fork = forks[source];
		uint256 beforeShares = recoveredQuestionShares[source][questionId];
		uint256 afterShares = beforeShares + shares;
		require(afterShares <= question.outcomeSupplyAttoShares, 'Recovery exceeds source supply');
		recoveredQuestionShares[source][questionId] = afterShares;
		uint256 units =
			Math.mulDiv(question.units, afterShares, question.outcomeSupplyAttoShares) -
				Math.mulDiv(question.units, beforeShares, question.outcomeSupplyAttoShares);
		// Fully accrued holding fees can exhaust ETH units while the separate
		// prepaid resolution budget still belongs to these authenticated shares.
		if (fork.units != 0)
			cash =
				Math.mulDiv(fork.neutralCash, fork.recoveredUnits + units, fork.units) -
				Math.mulDiv(fork.neutralCash, fork.recoveredUnits, fork.units);
		fork.recoveredUnits += units;
	}
}

contract SecurityPoolPortfolioForkCoordinatorDeployer is SecurityPoolCreationCodeDeployer {
	constructor() SecurityPoolCreationCodeDeployer(type(SecurityPoolPortfolioForkCoordinator).creationCode) {}
	function create(address authority, Zoltar zoltar) external returns (address) {
		return _deploy(abi.encode(authority, zoltar));
	}
}
