// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCreationCodeDeployer } from './SecurityPoolCreationCode.sol';

import { Zoltar } from '../Zoltar.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolCommitmentIndex } from './SecurityPoolCommitmentIndex.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { SecurityPoolPersistentMap } from './SecurityPoolPersistentMap.sol';
import { SecurityPoolPortfolioRecapAuction } from './SecurityPoolPortfolioRecapAuction.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface IPortfolioForkRoot {
	function originUniverseId() external view returns (uint248);
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function settlement() external view returns (SecurityPoolPortfolioSettlement);
	function reporters() external view returns (SecurityPoolReporterLedger);
	function logicalTime(uint248 universeId) external view returns (uint48);
	function forkLogicalTime(uint248 universeId) external view returns (uint48);
	function clocks(uint248 universeId) external view returns (uint48, uint48, bool, bool);
	function prepareForkChild(uint248 parent, uint256 outcome) external returns (SecurityPoolCapitalLedger);
	function activateForkChild(uint248 child) external;
	function creditForkFees(uint248 universeId, uint256 amount) external;
	function getPool(uint256 questionId, uint248 universeId) external view returns (ISecurityPool);
}

interface IPortfolioRecoveryShares {
	function consumePortfolioRecoveryCompleteSets(uint248 sourceUniverse, address holder, uint256 amount) external returns (uint256);
}

contract SecurityPoolPortfolioRecapAuctionDeployer {
	function create(SecurityPoolPortfolioRecapAuction.Configuration calldata configuration) external returns (SecurityPoolPortfolioRecapAuction) {
		return new SecurityPoolPortfolioRecapAuction(configuration);
	}
}

/// @notice One owner choice and one shared migration per actual native fork.
/// @dev No operation enumerates questions, owners, bidders or previous forks.
/// Principal outside pledged positions and old vested income remain in the parent.
contract SecurityPoolPortfolioForkCoordinator {
	using SafeERC20Ops for IERC20;
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;

	IPortfolioForkRoot public immutable portfolio;
	Zoltar public immutable zoltar;
	SecurityPoolPortfolioRecapAuctionDeployer public immutable auctionDeployer;
	bool private entered;
	struct UniverseClock {
		uint48 logicalAnchor;
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
		uint256 price;
		uint256 assignedCash;
		uint256 neutralCash;
		uint256 recoveredUnits;
		bool frozen;
		bool recoveryFunded;
		bool migrationPrepared;
	}
	struct Branch {
		uint248 parent;
		uint256 outcome;
		uint256 chosenBacking;
		uint256 chosenCommitment;
		uint256 parentCash;
		uint256 protectedCommitment;
		SecurityPoolPortfolioRecapAuction auction;
		bool prepared;
		bool started;
		bool ready;
	}
	struct Choice {
		uint256 outcome;
		bool recorded;
	}
	struct FixedOutcome {
		uint256 outcome;
	}
	mapping(uint248 => Fork) public forks;
	mapping(uint248 => Branch) public branches;
	mapping(uint248 => mapping(address => Choice)) public choices;
	mapping(uint248 => mapping(uint256 => uint256)) public recoveredQuestionShares;
	mapping(uint248 => uint64) private fixedRoots;
	SecurityPoolPersistentMap.Store private fixedTree;
	FixedOutcome[] private fixedOutcomes;

	event ForkFrozen(uint248 indexed universeId, uint256 backing, uint256 cash, uint256 units, uint256 freshPrice);
	event BranchChosen(uint248 indexed universeId, address indexed owner, uint256 indexed outcome, uint256 backing, uint256 commitment);
	event BranchStarted(uint248 indexed universeId, uint256 parentCash, uint256 unchosenBacking, address auction);
	event BranchActivated(uint248 indexed universeId, uint256 fundedCash, uint256 protectedCommitment);
	event NeutralCashRecovered(uint248 indexed universeId, uint256 indexed questionId, address indexed owner, uint256 shares, uint256 cash);
	event ProtectedPrincipalBurned(uint248 indexed universeId, uint256 rep);

	constructor(address authority, Zoltar protocol, SecurityPoolPortfolioRecapAuctionDeployer auctions) {
		require(authority != address(0) && address(auctions).code.length != 0, 'Fork dependencies missing');
		portfolio = IPortfolioForkRoot(authority);
		zoltar = protocol;
		auctionDeployer = auctions;
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
		require(msg.sender == address(portfolio) && clocks[origin].registered && !branches[origin].prepared, 'Origin activation unavailable');
		clocks[origin].ready = true;
	}
	function isReady(uint248 universeId) external view returns (bool) {
		return clocks[universeId].ready;
	}
	/// @notice Donate real ETH to existing branch claims without issuing shares.
	/// Retirement keeps priority over the additional commitment needed for repair.
	function recapitalizeUniverse(uint248 universeId) external payable nonReentrant {
		require(msg.value != 0, 'Repair amount zero');
		require(clocks[universeId].ready, 'Universe is not ready');
		require(zoltar.getForkTime(universeId) == 0, 'Universe already forked');
		SecurityPoolCapitalLedger capital = portfolio.capitalLedger(universeId);
		SecurityPoolPortfolioSettlement engine = portfolio.settlement();
		capital.checkpoint();
		(uint256 cash, uint256 units, , , ) = engine.ledger().totals(engine.bookIds(universeId));
		require(msg.value <= units - cash, 'Repair exceeds settlement shortfall');
		capital.setDemand(cash + msg.value);
		(uint256 fees, uint256 demand) = engine.recapitalize{value: msg.value}(universeId, logicalTime(universeId));
		if (fees != 0) portfolio.creditForkFees(universeId, fees);
		capital.synchronizeDemand(demand);
	}
	function logicalTime(uint248 universeId) public view returns (uint48) {
		uint256 wall = zoltar.getForkTime(universeId);
		return _logicalAt(universeId, wall == 0 ? block.timestamp : Math.min(wall, block.timestamp));
	}
	function _logicalAt(uint248 universeId, uint256 wall) private view returns (uint48) {
		UniverseClock memory clock = clocks[universeId];
		require(clock.registered, 'Unknown portfolio universe');
		uint256 logical = clock.logicalAnchor + (wall > clock.wallAnchor ? wall - clock.wallAnchor : 0);
		require(logical <= type(uint48).max, 'Portfolio clock exhausted');
		return uint48(logical);
	}
	function forkLogicalTime(uint248 universeId) external view returns (uint48) {
		uint256 forkTime = zoltar.getForkTime(universeId);
		require(forkTime != 0, 'Universe has not forked');
		return _logicalAt(universeId, forkTime);
	}
	function logicalTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48) {
		return _logicalAt(universeId, timestamp);
	}
	function nativeTimeForLogical(uint248 universeId, uint48 timestamp) external view returns (uint48) {
		UniverseClock memory clock = clocks[universeId];
		require(clock.registered && timestamp >= clock.logicalAnchor, 'Logical time precedes universe');
		uint256 wall = uint256(clock.wallAnchor) + timestamp - clock.logicalAnchor;
		require(wall <= type(uint48).max, 'Native clock exhausted');
		return uint48(wall);
	}

	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256) {
		uint256 id = fixedTree.get(fixedRoots[universeId], questionId);
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
		(fork.cash, fork.units, ) = portfolio.settlement().sealUniverse(universeId, portfolio.forkLogicalTime(universeId));
		portfolio.reporters().freezeFork(universeId);
		fork.backing = capital.frozenBackingAttoRep();
		fork.commitment = capital.frozenCommitmentAttoEth();
		if (zoltar.getForkTime(universeId) < capital.priceValidUntil()) fork.price = capital.acceptedPrice();
		fork.frozen = true;
		// Capital.freeze checkpoints every pre-fork earned fee before weights freeze.
		emit ForkFrozen(universeId, fork.backing, fork.cash, fork.units, fork.price);
	}

	function choose(uint248 source, uint256 outcome) external nonReentrant {
		_freeze(source);
		require(block.timestamp < zoltar.getForkChoiceDeadline(source), 'Fork choice window closed');
		require(!choices[source][msg.sender].recorded, 'Fork choice already recorded');
		uint248 child = _prepare(source, outcome);
		SecurityPoolCapitalLedger parentCapital = portfolio.capitalLedger(source);
		(SecurityPoolCapitalLedger.ChoicePosition[3] memory positions, uint256 target, uint256 reserve) = parentCapital.exportChoice(msg.sender);
		uint256 rep;
		uint256 commitment;
		for (uint256 i; i < 3; i++) {
			rep += positions[i].rep;
			commitment += positions[i].commitment;
		}
		require(rep != 0, 'No pledged fork principal');
		Fork storage fork = forks[source];
		Branch storage branch = branches[child];
		uint256 previousCash = branch.parentCash;
		branch.chosenBacking += rep;
		branch.chosenCommitment += commitment;
		branch.parentCash = Math.mulDiv(fork.cash, branch.chosenBacking, fork.backing);
		fork.assignedCash += branch.parentCash - previousCash;
		choices[source][msg.sender] = Choice(outcome, true);
		portfolio.capitalLedger(child).importChoice{value: reserve}(msg.sender, positions, target);
		emit BranchChosen(source, msg.sender, outcome, rep, commitment);
	}

	function _prepare(uint248 parent, uint256 outcome) private returns (uint248 child) {
		child = zoltar.getChildUniverseId(parent, outcome);
		Branch storage branch = branches[child];
		if (branch.prepared) return child;
		uint256 anchor = zoltar.getForkRecapitalizationDeadline(parent);
		require(anchor <= type(uint48).max, 'Fork clock exhausted');
		clocks[child] = UniverseClock(_logicalAt(parent, zoltar.getForkTime(parent)), uint48(anchor), true, false);
		portfolio.prepareForkChild(parent, outcome);
		branch.parent = parent;
		branch.outcome = outcome;
		branch.prepared = true;
		uint64 root = fixedRoots[parent];
		(, uint256 questionId, , , ) = zoltar.universes(parent);
		// A later fork cannot overwrite a question outcome already fixed in an ancestor.
		if (fixedTree.get(root, questionId) == 0) {
			fixedOutcomes.push(FixedOutcome(outcome));
			root = fixedTree.set(root, questionId, fixedOutcomes.length - 1, 0);
		}
		fixedRoots[child] = root;
	}

	function startBranch(uint248 parent, uint256 outcome) external nonReentrant returns (uint248 child) {
		_freeze(parent);
		child = _prepare(parent, outcome);
		_start(child);
	}
	function _start(uint248 child) private {
		Branch storage branch = branches[child];
		if (branch.started) return;
		require(block.timestamp >= zoltar.getForkChoiceDeadline(branch.parent), 'Fork choices still open');
		Fork storage fork = forks[branch.parent];
		branch.started = true;
		SecurityPoolCapitalLedger sourceCapital = portfolio.capitalLedger(branch.parent);
		SecurityPoolCapitalLedger childCapital = portfolio.capitalLedger(child);
		if (!fork.migrationPrepared) {
			fork.migrationPrepared = true;
			sourceCapital.releaseForkBacking();
			if (fork.backing != 0) {
				IERC20 sourceToken = IERC20(address(zoltar.getRepToken(branch.parent)));
				if (address(sourceToken) == address(zoltar.genesisReputationToken()))
					sourceToken.safeApprove(address(zoltar), fork.backing);
				zoltar.addRepToMigrationBalance(branch.parent, fork.backing);
			}
		}
		if (fork.backing != 0) {
			uint256[] memory outcomes = new uint256[](1);
			outcomes[0] = branch.outcome;
			zoltar.splitMigrationRep(branch.parent, fork.backing, outcomes);
		}
		IERC20 token = IERC20(address(zoltar.getRepToken(child)));
		if (branch.chosenBacking != 0) token.safeTransfer(address(childCapital), branch.chosenBacking);
		portfolio.reporters().createChild(branch.parent, branch.outcome);
		portfolio.settlement().createChildUniverse(branch.parent, child, branch.parentCash);
		portfolio.settlement().setFeeClock(child, uint48(zoltar.getForkRecapitalizationDeadline(branch.parent)));
		(, uint256 forkQuestion, , , ) = zoltar.universes(branch.parent);
		portfolio.settlement().fixInheritedQuestionFinality(child, forkQuestion, clocks[child].logicalAnchor + 3 days);
		uint256 unchosen = fork.backing - branch.chosenBacking;
		if (fork.price != 0) {
			childCapital.setAuctionReferencePrice(fork.price);
			uint256 healthy = childCapital.commitmentIndex().eligibleCommitment(fork.price);
			uint256 shortfall = fork.units > healthy ? fork.units - healthy : 0;
			branch.protectedCommitment = Math.min(shortfall, childCapital.maximumHealthyCommitment(unchosen));
			uint256 missingCash = fork.units - branch.parentCash;
			if (unchosen != 0 && missingCash != 0) {
				uint256 reservePrice = Math.mulDiv(1e18, 1e18, fork.price, Math.Rounding.Ceil);
				branch.auction = auctionDeployer.create(SecurityPoolPortfolioRecapAuction.Configuration(address(this), uint48(zoltar.getForkChoiceDeadline(branch.parent)), uint48(zoltar.getForkRecapitalizationDeadline(branch.parent)), unchosen, missingCash, reservePrice, reservePrice <= type(uint256).max / 2 ? reservePrice * 2 : reservePrice, childCapital.securityMultiplierBps(), branch.protectedCommitment));
			}
		} else {
			// A stale source price never authorizes a sale. Preserve the unsold
			// source obligations until a fresh child price permits retirement/cure.
			uint256 missing = fork.units > branch.chosenCommitment ? fork.units - branch.chosenCommitment : 0;
			branch.protectedCommitment = Math.min(missing, fork.commitment - branch.chosenCommitment);
		}
		emit BranchStarted(child, branch.parentCash, unchosen, address(branch.auction));
	}

	/// @notice A purchase atomically accepts its stated K and chosen health target.
	/// Any required top-up comes from this buyer; existing owners are never debited.
	function buyRecapitalization(uint248 child, uint256 maximumRep, uint256 minimumRep, uint256 maximumCommitment, uint256 maximumOwnRep, uint256 targetHealth, uint256 executionReserve) external payable nonReentrant returns (uint256 rep, uint256 commitment) {
		Branch storage branch = branches[child];
		require(branch.started && !branch.ready && address(branch.auction) != address(0), 'Recap sale unavailable');
		require(msg.value >= executionReserve && targetHealth >= 10_000, 'Invalid recap funding');
		uint256 cost;
		(rep, commitment, cost) = branch.auction.quote(msg.value - executionReserve, maximumRep);
		require(rep >= minimumRep, 'Recap REP below minimum');
		branch.auction.commitFill{value: cost}(msg.sender, rep, maximumCommitment);
		SecurityPoolCapitalLedger capital = portfolio.capitalLedger(child);
		IERC20 token = IERC20(address(zoltar.getRepToken(child)));
		if (commitment == 0) {
			require(executionReserve == 0, 'Free REP needs no execution reserve');
			token.safeTransfer(msg.sender, rep);
		} else {
			uint256 own = _requiredRecapTopUp(capital, msg.sender, rep, commitment, targetHealth);
			require(own <= maximumOwnRep, 'Recap top-up exceeds consent');
			token.safeTransfer(address(capital), rep);
			if (own != 0) token.safeTransferFrom(msg.sender, address(capital), own);
			capital.importAuctionPosition{value: executionReserve}(msg.sender, rep + own, commitment, targetHealth);
		}
		uint256 refund = msg.value - cost - executionReserve;
		if (refund != 0) {
			(bool sent, ) = msg.sender.call{value: refund}('');
			require(sent, 'Recap refund failed');
		}
	}
	function _requiredRecapTopUp(SecurityPoolCapitalLedger capital, address buyer, uint256 rep, uint256 commitment, uint256 health) private view returns (uint256) {
		uint256 required = capital.requiredRep(commitment, health);
		SecurityPoolCapitalLedger.Owner memory owner = capital.ownerAccount(buyer);
		for (uint256 i; i < 3; i++) {
			if (owner.positions[i] == 0) continue;
			SecurityPoolCommitmentIndex.Account memory existing = capital.commitmentIndex().accountOf(owner.positions[i]);
			if (existing.batch != 0) continue;
			uint256 combined = capital.requiredRep(existing.commitment + commitment, health);
			if (combined > existing.rep) required = Math.max(required, combined - existing.rep);
			break;
		}
		return required > rep ? required - rep : 0;
	}

	function finalizeBranch(uint248 child) external nonReentrant {
		_finalize(child);
	}
	function _finalize(uint248 child) private {
		Branch storage branch = branches[child];
		require(branch.prepared, 'Fork branch unknown');
		if (branch.ready) return;
		_start(child);
		require(block.timestamp >= zoltar.getForkRecapitalizationDeadline(branch.parent), 'Recap window still open');
		uint256 proceeds;
		uint256 sold;
		uint256 soldCommitment;
		if (address(branch.auction) != address(0)) {
			branch.auction.finalize();
			proceeds = branch.auction.raisedAttoEth();
			sold = branch.auction.soldAttoRep();
			soldCommitment = branch.auction.assignedCommitmentAttoEth();
			if (proceeds != 0) branch.auction.withdrawProceeds();
		}
		uint256 retained = forks[branch.parent].backing - branch.chosenBacking - sold;
		uint256 retainedK = branch.protectedCommitment - soldCommitment;
		SecurityPoolCapitalLedger capital = portfolio.capitalLedger(child);
		if (retainedK != 0) {
			IERC20(address(zoltar.getRepToken(child))).safeTransfer(address(capital), retained);
			// One protocol-owned reserve per universe cannot create owner spam.
			// Both inherited owner cohorts retain priority over its retirement.
			capital.importProtocolReserve(retained, retainedK);
		} else if (retained != 0) zoltar.burnRep(child, retained);
		(uint48 logicalAnchor, , , ) = portfolio.clocks(child);
		uint256 demand = branch.parentCash;
		uint256 fees;
		if (proceeds != 0)
			(fees, demand) = portfolio.settlement().recapitalize{value: proceeds}(child, logicalAnchor);
		if (fees != 0) portfolio.creditForkFees(child, fees);
		capital.finishForkImport(demand);
		branch.ready = true;
		clocks[child].ready = true;
		portfolio.activateForkChild(child);
		emit BranchActivated(child, demand, retainedK);
	}

	/// @notice Resolve only this actual fork, never recursively walk ancestors.
	function ensureReady(uint248 child) external nonReentrant {
		if (child == portfolio.originUniverseId()) return;
		if (!branches[child].prepared) {
			(, , uint256 outcome, , uint248 parent) = zoltar.universes(child);
			require(address(zoltar.getRepToken(child)) != address(0), 'Native child not deployed');
			_freeze(parent);
			require(_prepare(parent, outcome) == child, 'Wrong native child');
		}
		_finalize(child);
	}

	/// @notice Burn only the unchosen protocol reserve after its liabilities retire.
	function collectProtectedPrincipal(uint248 child) external nonReentrant {
		require(branches[child].ready, 'Branch is not active');
		SecurityPoolCapitalLedger capital = portfolio.capitalLedger(child);
		// A later fork freezes pledged backing, not earlier released principal
		// or income. Those parent claims remain collectable without new retirement.
		if (zoltar.getForkTime(child) == 0) capital.serveRetirement();
		capital.claimEarnings();
		SecurityPoolCapitalLedger.Owner memory account = capital.ownerAccount(address(this));
		if (account.freeAttoRep != 0) capital.withdrawFree(account.freeAttoRep, address(this));
		uint256 rep = IERC20(address(zoltar.getRepToken(child))).balanceOf(address(this));
		if (rep != 0) {
			zoltar.burnRep(child, rep);
			emit ProtectedPrincipalBurned(child, rep);
		}
	}

	/// @notice Unassigned source cash requires complete sets, independently of
	/// every child token mint. Spending this right never burns branch entitlements.
	function recoverUnchosenCash(uint248 source, uint256 questionId, uint256 shares) external nonReentrant returns (uint256 cash) {
		_freeze(source);
		require(block.timestamp >= zoltar.getForkChoiceDeadline(source), 'Fork choices still open');
		Fork storage fork = forks[source];
		SecurityPoolPortfolioSettlement settlement = portfolio.settlement();
		if (!fork.recoveryFunded) {
			fork.recoveryFunded = true;
			fork.neutralCash = fork.cash - fork.assignedCash;
			if (fork.neutralCash != 0) settlement.withdrawForkRecoveryCash(source, fork.neutralCash);
		}
		(SecurityPoolSettlementBook.Question memory question, uint64 frozenBook) = settlement.ledger().question(settlement.bookIds(source), questionId);
		require(frozenBook == 0 && question.outcomeSupplyAttoShares != 0 && fork.units != 0, 'No live source recovery right');
		ISecurityPool pool = portfolio.getPool(questionId, source);
		IPortfolioRecoveryShares(address(pool.shareToken())).consumePortfolioRecoveryCompleteSets(source, msg.sender, shares);
		uint256 beforeShares = recoveredQuestionShares[source][questionId];
		uint256 afterShares = beforeShares + shares;
		require(afterShares <= question.outcomeSupplyAttoShares, 'Recovery exceeds source supply');
		recoveredQuestionShares[source][questionId] = afterShares;
		uint256 units =
			Math.mulDiv(question.units, afterShares, question.outcomeSupplyAttoShares) -
				Math.mulDiv(question.units, beforeShares, question.outcomeSupplyAttoShares);
		cash =
			Math.mulDiv(fork.neutralCash, fork.recoveredUnits + units, fork.units) -
			Math.mulDiv(fork.neutralCash, fork.recoveredUnits, fork.units);
		fork.recoveredUnits += units;
		if (cash != 0) {
			(bool sent, ) = msg.sender.call{value: cash}('');
			require(sent, 'Recovery transfer failed');
		}
		emit NeutralCashRecovered(source, questionId, msg.sender, shares, cash);
	}
}

contract SecurityPoolPortfolioForkCoordinatorDeployer is SecurityPoolCreationCodeDeployer {
	SecurityPoolPortfolioRecapAuctionDeployer public immutable auctions;
	constructor(SecurityPoolPortfolioRecapAuctionDeployer auctionFactory) SecurityPoolCreationCodeDeployer(type(SecurityPoolPortfolioForkCoordinator).creationCode) {
		auctions = auctionFactory;
	}
	function create(address authority, Zoltar zoltar) external returns (address) {
		return _deploy(abi.encode(authority, zoltar, auctions));
	}
}
