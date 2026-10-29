// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

interface ITestForkInitializer {
	function initialize(uint248 origin) external;
	function activateOrigin(uint248 origin) external;
}

import { ReputationToken } from '../../ReputationToken.sol';
import { Zoltar } from '../../Zoltar.sol';
import { ISecurityPool } from '../../statoblast/interfaces/ISecurityPool.sol';
import { SecurityPoolCapitalLedger } from '../../statoblast/SecurityPoolCapitalLedger.sol';
import { ICapitalFeeStreams } from '../../statoblast/interfaces/ICapitalAccounting.sol';
import { SecurityPoolPortfolioSettlement } from '../../statoblast/SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from '../../statoblast/SecurityPoolSettlementBook.sol';
import { SecurityPoolReporterLedger } from '../../statoblast/SecurityPoolReporterLedger.sol';
import {
	SecurityPoolCapitalLedgerDeployer,
	SecurityPoolCommitmentIndexDeployer,
	SecurityPoolCapitalFeeStreamsDeployer
} from '../../statoblast/SecurityPoolPortfolioModuleDeployers.sol';

/// @dev Native migration is independently tested against Zoltar. This substitute
/// gives the composed portfolio tests explicit fork times and exact child mints.
contract PortfolioForkZoltarMock {
	struct Universe {
		uint256 forkTime;
		uint256 forkQuestionId;
		uint256 outcome;
		ReputationToken token;
		uint248 parent;
	}
	mapping(uint248 => Universe) public universes;
	mapping(address => mapping(uint248 => uint256)) private migration;
	mapping(address => mapping(uint248 => uint256)) private minted;
	constructor() {
		ReputationToken token = new ReputationToken(address(this));
		token.initialize(1, 11_000_000e18, 1);
		universes[0].token = token;
	}
	function getRepToken(uint248 u) external view returns (ReputationToken) {
		return universes[u].token;
	}
	function genesisReputationToken() external view returns (ReputationToken) {
		return universes[0].token;
	}
	function getForkTime(uint248 u) external view returns (uint256) {
		return universes[u].forkTime;
	}
	function getForkChoiceDeadline(uint248 u) public view returns (uint256) {
		return universes[u].forkTime + 8 weeks;
	}
	function getForkRecapitalizationDeadline(uint248 u) external view returns (uint256) {
		return getForkChoiceDeadline(u) + 1 weeks;
	}
	function getChildUniverseId(uint248 u, uint256 outcome) public pure returns (uint248) {
		return uint248(uint256(keccak256(abi.encode(u, outcome))));
	}
	function deployChild(uint248 u, uint256 outcome) public {
		require(universes[u].forkTime != 0 && outcome < 3, 'Invalid native child');
		uint248 child = getChildUniverseId(u, outcome);
		require(address(universes[child].token) == address(0), 'Child exists');
		ReputationToken token = new ReputationToken(address(this));
		token.initialize(child, 11_000_000e18, 2);
		universes[child] = Universe(0, universes[u].forkQuestionId, outcome, token, u);
	}
	function mint(uint248 u, address recipient, uint256 amount) external {
		universes[u].token.mint(recipient, amount);
	}
	function setFork(uint248 u, uint256 q) external {
		require(universes[u].forkTime == 0, 'Already forked');
		universes[u].forkTime = block.timestamp;
		universes[u].forkQuestionId = q;
	}
	function setForkTimestamp(uint248 u, uint256 timestamp) external {
		require(universes[u].forkTime != 0 && timestamp <= block.timestamp, 'Invalid test fork time');
		universes[u].forkTime = timestamp;
	}
	function burnRep(uint248 u, uint256 amount) external {
		universes[u].token.burn(msg.sender, amount);
	}
	function addRepToMigrationBalance(uint248 u, uint256 amount) external {
		universes[u].token.burn(msg.sender, amount);
		migration[msg.sender][u] += amount;
	}
	function getMigrationRepBalanceAttoRep(address owner, uint248 u) external view returns (uint256) {
		return migration[owner][u];
	}
	function splitMigrationRep(uint248 u, uint256 amount, uint256[] calldata outcomes) external {
		for (uint256 i; i < outcomes.length; i++) {
			uint248 child = getChildUniverseId(u, outcomes[i]);
			if (address(universes[child].token) == address(0)) deployChild(u, outcomes[i]);
			require(amount + minted[msg.sender][child] <= migration[msg.sender][u], 'Migration exceeds prepared');
			minted[msg.sender][child] += amount;
			universes[child].token.mint(msg.sender, amount);
		}
	}
}

contract PortfolioForkRecoverySharesMock {
	mapping(uint248 => mapping(address => uint256)) public holdings;
	mapping(uint248 => mapping(address => uint256)) public claimed;
	function setHolding(uint248 u, address owner, uint256 amount) external {
		holdings[u][owner] = amount;
	}
	function consumePortfolioRecoveryCompleteSets(uint248 u, address owner, uint256 amount) external returns (uint256 total) {
		require(amount != 0, 'Recovery amount is zero');
		total = claimed[u][owner] + amount;
		require(total <= holdings[u][owner], 'Recovery exceeds holdings');
		claimed[u][owner] = total;
	}
}
contract PortfolioForkQuestionMock {
	PortfolioForkRecoverySharesMock public immutable shareToken;
	constructor(PortfolioForkRecoverySharesMock token) {
		shareToken = token;
	}
}

contract PortfolioForkHarness {
	PortfolioForkZoltarMock public immutable zoltar;
	SecurityPoolCapitalLedgerDeployer private immutable capitalDeployer;
	SecurityPoolCommitmentIndexDeployer private immutable indexDeployer;
	SecurityPoolCapitalFeeStreamsDeployer private immutable streamsDeployer;
	uint248 public constant originUniverseId = 0;
	SecurityPoolPortfolioSettlement public settlement;
	SecurityPoolReporterLedger public reporters;
	address public forkController;
	address public immutable auctionDeployer;
	uint256 public constant minimumCommitmentAttoEth = 1e15;
	uint256 public constant minimumExecutionReserveAttoEth = 1e14;
	uint256 public constant auctionReserveFactorBps = 5_000;
	uint256 public constant initialReportPriorityFeeAttoEthPerGas = 2e9;
	struct Clock {
		uint48 logicalAnchor;
		uint48 wallAnchor;
		bool registered;
		bool ready;
	}
	mapping(uint248 => Clock) public clocks;
	mapping(uint248 => SecurityPoolCapitalLedger) public capitalLedger;
	mapping(uint248 => mapping(uint256 => ISecurityPool)) private pools;

	constructor(PortfolioForkZoltarMock protocol, SecurityPoolCapitalLedgerDeployer capitals, SecurityPoolCommitmentIndexDeployer indices, SecurityPoolCapitalFeeStreamsDeployer streams, address auctions) {
		zoltar = protocol;
		capitalDeployer = capitals;
		indexDeployer = indices;
		streamsDeployer = streams;
		auctionDeployer = auctions;
		clocks[0] = Clock(0, 0, true, true);
	}
	receive() external payable {}
	function initialize(SecurityPoolPortfolioSettlement engine, SecurityPoolSettlementBook book, SecurityPoolReporterLedger reporter, address coordinator) external {
		require(forkController == address(0), 'Already initialized');
		settlement = engine;
		reporters = reporter;
		forkController = coordinator;
		ITestForkInitializer(coordinator).initialize(0);
		settlement.initialize(book);
		settlement.registerUniverse(0, uint48(block.timestamp));
		reporters.registerUniverse(0);
		_createCapital(0);
		ITestForkInitializer(coordinator).activateOrigin(0);
	}
	function logicalTime(uint248 u) public view returns (uint48) {
		uint256 wall = zoltar.getForkTime(u);
		if (wall == 0) wall = block.timestamp;
		Clock memory c = clocks[u];
		return c.logicalAnchor + (wall > c.wallAnchor ? uint48(wall - c.wallAnchor) : 0);
	}
	function forkLogicalTime(uint248 u) external view returns (uint48) {
		return logicalTime(u);
	}
	function _createCapital(uint248 u) private returns (SecurityPoolCapitalLedger capital) {
		capital = capitalDeployer.create(address(this), Zoltar(address(zoltar)), u, 10_500, 1e15, 1e14, 1 days);
		capital.initialize(indexDeployer.create(address(capital)), ICapitalFeeStreams(address(streamsDeployer.create(address(capital), uint48(block.timestamp), 1 days))), forkController, address(this));
		capitalLedger[u] = capital;
	}
	function prepareForkChild(uint248 source, uint256 outcome) external returns (SecurityPoolCapitalLedger capital) {
		require(msg.sender == forkController, 'Only fork coordinator');
		uint248 child = zoltar.getChildUniverseId(source, outcome);
		if (address(zoltar.getRepToken(child)) == address(0)) zoltar.deployChild(source, outcome);
		require(!clocks[child].registered, 'Child exists');
		clocks[child] = Clock(logicalTime(source), uint48(zoltar.getForkRecapitalizationDeadline(source)), true, false);
		capital = _createCapital(child);
		capital.beginForkImport();
	}
	function activateForkChild(uint248 u) external {
		require(msg.sender == forkController, 'Only fork coordinator');
		clocks[u].ready = true;
	}
	function creditForkFees(uint248 u, uint256 amount) external {
		require(msg.sender == forkController, 'Only fork coordinator');
		capitalLedger[u].creditTimedFees{value: amount}();
	}
	function setPrice(uint248 u, uint256 price, uint48 expiry) external {
		capitalLedger[u].acceptPrice(price, expiry);
	}
	function priceFeed(uint248) external view returns (address) {
		return address(this);
	}
	function validateExposure() external pure {}
	function acceptedEpoch() external pure returns (uint256) {
		return 1;
	}
	function targetPriceErrorForDispute() external pure returns (uint256) {
		return 0;
	}
	function services() external view returns (address) {
		return address(this);
	}
	function freezePremiumUniverse(uint248) external pure {}
	function onPremiumChoice(uint248, uint248, uint256, uint256) external pure {}
	function createPremiumChild(uint248, uint248) external pure {}
	function checkpointPreparationPremium(uint248) external pure {}
	mapping(uint256 => uint256) public recoveryPremiumAttoEth;
	mapping(uint256 => uint256) public recoveredPremiumShares;
	mapping(address => uint256) public recoveredPremiumAttoEth;
	function fundRecoveryPremium(uint256 questionId) external payable {
		recoveryPremiumAttoEth[questionId] += msg.value;
	}
	function recoverPremiumCash(uint248 u, uint256 questionId, uint256 shares, address recipient) external returns (uint256 cash) {
		require(msg.sender == forkController, 'Only fork coordinator');
		(SecurityPoolSettlementBook.Question memory question, ) = settlement.ledger().question(settlement.bookIds(u), questionId);
		uint256 beforeShares = recoveredPremiumShares[questionId];
		uint256 afterShares = beforeShares + shares;
		require(afterShares <= question.outcomeSupplyAttoShares, 'Premium exceeds supply');
		recoveredPremiumShares[questionId] = afterShares;
		cash =
			(recoveryPremiumAttoEth[questionId] * afterShares) / question.outcomeSupplyAttoShares -
			(recoveryPremiumAttoEth[questionId] * beforeShares) / question.outcomeSupplyAttoShares;
		recoveredPremiumAttoEth[recipient] += cash;
		if (cash != 0) {
			(bool sent, ) = recipient.call{value: cash}('');
			require(sent, 'Premium recovery failed');
		}
	}
	function setQuestionFee(uint248 u, uint256 q, uint96 rate, uint48 end) external {
		settlement.setFeesEnabled(u, true, logicalTime(u));
		settlement.replaceFeeStream(address(pools[u][q]), rate, end, logicalTime(u));
	}
	function creditServiceFees(uint248) external payable {}
	function checkpointCapitalFees(uint248 u, uint48) external {
		require(msg.sender == address(capitalLedger[u]), 'Only capital');
		uint64 book = settlement.bookIds(u);
		if (book == 0) return;
		(, , , , bool isSealed) = settlement.ledger().totals(book);
		if (isSealed) return;
		(uint256 fees, uint256 demand) = settlement.checkpointUniverse(u, logicalTime(u));
		if (fees != 0) capitalLedger[u].creditTimedFees{value: fees}();
		capitalLedger[u].synchronizeDemand(demand);
	}
	function registerQuestion(uint248 u, uint256 q, ISecurityPool pool) external {
		pools[u][q] = pool;
		settlement.registerQuestion(address(pool), u, q);
	}
	function getPool(uint256 q, uint248 u) external view returns (ISecurityPool) {
		return pools[u][q];
	}
	function mintQuestion(uint256 q) external payable {
		capitalLedger[0].setDemand(capitalLedger[0].demandAttoEth() + msg.value);
		settlement.mint{value: msg.value}(address(pools[0][q]), 0, logicalTime(0));
	}
	function redeemQuestion(uint248 u, uint256 q, uint256 shares, address recipient) external {
		settlement.redeem(address(pools[u][q]), recipient, shares, 0, logicalTime(u));
		(uint256 fees, uint256 demand) = settlement.checkpointUniverse(u, logicalTime(u));
		if (fees != 0) capitalLedger[u].creditTimedFees{value: fees}();
		capitalLedger[u].synchronizeDemand(demand);
	}
	function scheduleQuestionFinality(uint248 u, uint256 q, uint48 finalAfter) external {
		settlement.scheduleFinality(address(pools[u][q]), finalAfter, logicalTime(u));
	}
}
