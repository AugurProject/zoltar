// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { UniverseIds } from '../../UniverseIds.sol';

import '../../Constants.sol';
import './TokenId.sol';
import '../../Zoltar.sol';
import '../interfaces/IQuestionLedger.sol';
import '../interfaces/IQuestionForker.sol';
import '../interfaces/IShareToken.sol';
import '../BinaryOutcomes.sol';
import './ERC1155.sol';
import '../SecurityPoolPortfolioSettlement.sol';

interface IShareTokenPortfolioForkAuthority {
	function forkController() external view returns (address);
	function settlement() external view returns (SecurityPoolPortfolioSettlement);
	function forkPortfolioTime(uint248 universeId) external view returns (uint48);
}

/**
 * @title Share Token
 * @notice ERC1155 contract to hold all share token balances
 */
contract ShareToken is ERC1155, IShareToken {
	string public name;
	string public symbol;
	Zoltar public immutable zoltar;
	mapping(address => bool) private authorized;
	mapping(uint248 => IQuestionLedger) public canonicalQuestionLedgerByUniverse;
	// Forked source shares remain as branch-independent entitlements. Once an
	// account materializes any branch, its source balance is locked so a transfer
	// cannot let both sender and receiver reproduce the same claim.
	// Source token ID -> target universe ID -> account -> shares already materialized, in attoShares.
	mapping(uint256 => mapping(uint248 => mapping(address => uint256))) private migratedShareAmountAttoShares;
	// Recovery credits are independently transferable. Spending a source-backed
	// right locks its source token; incoming credits alone never lock a recipient.
	struct SourceAccount {
		uint256 recoveryCredits;
		uint256 recoverySourceSpent;
		bool balanceLocked;
	}
	// Source token ID -> account -> branch-independent recovery and transfer state.
	mapping(uint256 => mapping(address => SourceAccount)) private sourceAccounts;
	mapping(uint248 => mapping(address => uint256)) public recoveredCompleteSetShares;
	event PortfolioRecoveryRightsTransferred(uint248 indexed universeId, address indexed from, address indexed to, uint256[3] amountsAttoShares);
	event PortfolioRecoveryRightsConsumed(uint248 indexed universeId, address indexed holder, uint256 amountAttoShares, uint256 cumulativeAttoShares);
	event Migrate(address indexed migrator, uint256 indexed fromId, uint256 indexed toId, uint256 amountAttoShares);

	constructor(address owner, Zoltar _zoltar, uint256 questionId) {
		zoltar = _zoltar;
		string memory questionIdString = uintToString(questionId);
		name = string.concat('Shares-', questionIdString);
		symbol = string.concat('SHARE-', questionIdString);
		authorized[owner] = true;
		emit AuthorizationUpdated(owner, msg.sender, true);
	}

	function uintToString(uint256 value) internal pure returns (string memory) {
		if (value == 0) return '0';

		uint256 digits = 0;
		uint256 temp = value;
		while (temp != 0) {
			digits++;
			temp /= 10;
		}

		bytes memory buffer = new bytes(digits);
		while (value != 0) {
			digits--;
			buffer[digits] = bytes1(uint8(48 + (value % 10)));
			value /= 10;
		}
		return string(buffer);
	}

	function authorize(IQuestionLedger _questionLedgerCandidate) external {
		require(authorized[msg.sender], 'ShareToken caller is not authorized to add another authorized pool');
		require(address(_questionLedgerCandidate.shareToken()) == address(this), 'ShareToken candidate must use this share token');
		uint248 candidateUniverseId = _questionLedgerCandidate.universeId();
		IQuestionLedger currentCanonicalPool = canonicalQuestionLedgerByUniverse[candidateUniverseId];
		require(address(currentCanonicalPool) == address(0x0) || address(currentCanonicalPool) == address(_questionLedgerCandidate), 'ShareToken universe already has a canonical pool');
		if (authorized[address(_questionLedgerCandidate)]) return;
		canonicalQuestionLedgerByUniverse[candidateUniverseId] = _questionLedgerCandidate;
		authorized[address(_questionLedgerCandidate)] = true;
		emit AuthorizationUpdated(address(_questionLedgerCandidate), msg.sender, true);
	}

	function isAuthorized(address account) external view returns (bool) {
		return authorized[account];
	}

	function getUniverseId(uint256 id) internal pure returns (uint248 universeId) {
		return uint248(id >> 8);
	}

	function getChildId(uint256 originalId, uint248 newUniverse) internal pure returns (uint256 newId) {
		return (uint256(newUniverse) << 8) | uint8(originalId);
	}

	function mintCompleteSets(uint248 _universeId, address _account, uint256 amountAttoShares) external {
		require(authorized[msg.sender], 'ShareToken caller is not authorized to mint complete sets');
		require(amountAttoShares > 0, 'Exchange rate undefined');
		uint256[] memory _tokenIds = new uint256[](Constants.NUM_OUTCOMES);
		uint256[] memory _values = new uint256[](Constants.NUM_OUTCOMES);

		for (uint8 i = 0; i < Constants.NUM_OUTCOMES; i++) {
			_tokenIds[i] = TokenId.getTokenId(_universeId, BinaryOutcomes.BinaryOutcome(i));
			_values[i] = amountAttoShares;
		}

		_mintBatch(_account, _tokenIds, _values);
	}

	function burnCompleteSets(uint248 _universeId, address _owner, uint256 amountAttoShares) external {
		require(authorized[msg.sender], 'ShareToken caller is not authorized to burn complete sets');
		uint256[] memory _tokenIds = new uint256[](Constants.NUM_OUTCOMES);
		uint256[] memory _values = new uint256[](Constants.NUM_OUTCOMES);

		for (uint8 i = 0; i < Constants.NUM_OUTCOMES; i++) {
			_tokenIds[i] = TokenId.getTokenId(_universeId, BinaryOutcomes.BinaryOutcome(i));
			_values[i] = amountAttoShares;
		}

		_burnBatch(_owner, _tokenIds, _values);
	}

	function burnTokenIdAndGetRemainingSupply(uint256 _tokenId, address _owner) external returns (uint256 balanceAttoShares, uint256 remainingSupplyAttoShares) {
		require(authorized[msg.sender], 'ShareToken caller is not authorized to burn this token id');
		balanceAttoShares = balanceOf(_owner, _tokenId);
		_burn(_owner, _tokenId, balanceAttoShares);
		remainingSupplyAttoShares = totalSupply(_tokenId);
	}

	function _getChildUniverseId(uint248 universeId, uint256 outcomeIndex) private pure returns (uint248) {
		return UniverseIds.child(universeId, outcomeIndex);
	}

	function totalSupplyForOutcome(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome) public view returns (uint256 totalSupplyAttoShares) {
		uint256 _tokenId = getTokenId(_universeId, _outcome);
		return totalSupply(_tokenId);
	}

	function maximumOutcomeSupply(uint248 _universeId) external view returns (uint256 maximumSupplyAttoShares) {
		maximumSupplyAttoShares = totalSupplyForOutcome(_universeId, BinaryOutcomes.BinaryOutcome.Invalid);
		uint256 yesSupplyAttoShares = totalSupplyForOutcome(_universeId, BinaryOutcomes.BinaryOutcome.Yes);
		uint256 noSupplyAttoShares = totalSupplyForOutcome(_universeId, BinaryOutcomes.BinaryOutcome.No);
		if (yesSupplyAttoShares > maximumSupplyAttoShares) maximumSupplyAttoShares = yesSupplyAttoShares;
		if (noSupplyAttoShares > maximumSupplyAttoShares) maximumSupplyAttoShares = noSupplyAttoShares;
	}

	function balanceOfOutcome(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome, address _account) public view returns (uint256 balanceAttoShares) {
		uint256 _tokenId = getTokenId(_universeId, _outcome);
		return balanceOf(_account, _tokenId);
	}

	function balanceOfShares(uint248 _universeId, address _account) public view returns (uint256[3] memory balancesAttoShares) {
		balancesAttoShares[0] = balanceOf(_account, getTokenId(_universeId, BinaryOutcomes.BinaryOutcome.Invalid));
		balancesAttoShares[1] = balanceOf(_account, getTokenId(_universeId, BinaryOutcomes.BinaryOutcome.Yes));
		balancesAttoShares[2] = balanceOf(_account, getTokenId(_universeId, BinaryOutcomes.BinaryOutcome.No));
	}

	function getMigratedShareAmountAttoShares(uint256 fromId, uint248 targetUniverseId, address account) external view returns (uint256) {
		return migratedShareAmountAttoShares[fromId][targetUniverseId][account];
	}

	function getTokenId(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome) public pure returns (uint256 _tokenId) {
		return TokenId.getTokenId(_universeId, _outcome);
	}

	function getTokenIds(uint248 _universeId, BinaryOutcomes.BinaryOutcome[] calldata _outcomes) external pure returns (uint256[] memory _tokenIds) {
		return TokenId.getTokenIds(_universeId, _outcomes);
	}

	function unpackTokenId(uint256 _tokenId) public pure returns (uint248 _universe, BinaryOutcomes.BinaryOutcome _outcome) {
		return TokenId.unpackTokenId(_tokenId);
	}

	function migrate(uint256 fromId, uint256[] calldata targetOutcomeIndexes) external {
		uint248 universeId = getUniverseId(fromId);
		require(zoltar.getForkTime(universeId) > 0, 'ShareToken universe has not forked, so shares cannot migrate');
		require(targetOutcomeIndexes.length > 0, 'ShareToken migration requires at least one target outcome');

		uint256 fromIdBalanceAttoShares = balanceOf(msg.sender, fromId);
		require(fromIdBalanceAttoShares > 0, 'ShareToken holder has no balance to migrate from the source token id');

		(, uint256 questionId, , , ) = zoltar.universes(universeId);
		uint256 targetOutcomeIndexesLength = targetOutcomeIndexes.length;
		uint256 previousOutcomeIndex;
		for (uint256 i = 0; i < targetOutcomeIndexesLength; i++) {
			uint256 outcomeIndex = targetOutcomeIndexes[i];
			require(!zoltar.zoltarQuestionData().isMalformedAnswerOption(questionId, outcomeIndex), 'ShareToken target outcome is malformed for the fork question');
			if (i > 0)
				require(outcomeIndex > previousOutcomeIndex, 'ShareToken target outcomes must be provided in strictly increasing order');
			previousOutcomeIndex = outcomeIndex;
		}

		IQuestionLedger sourcePool = canonicalQuestionLedgerByUniverse[universeId];
		require(address(sourcePool) != address(0x0), 'ShareToken source universe is missing a canonical pool');
		// A question whose claims became final before the fork settles in this
		// universe. A ledger that was never activated there reports no outcome, so
		// finality is read from the settlement schedule, as for recovery rights.
		require(sourcePool.portfolioCustody() == address(0) || isPortfolioRecoveryEligible(universeId), 'ShareToken question finalized before fork');
		IQuestionForker forker = IQuestionForker(sourcePool.questionForker());
		// A source ledger that was prepared but never activated before its universe
		// forked enters fork mode the same way an operational one does.
		if (sourcePool.systemState() != SystemState.PoolForked) {
			forker.initiateQuestionLedgerFork(sourcePool);
		}
		require(sourcePool.systemState() == SystemState.PoolForked, 'ShareToken source pool cannot migrate');

		uint248[] memory targetUniverseIds = new uint248[](targetOutcomeIndexesLength);
		for (uint256 i = 0; i < targetOutcomeIndexesLength; i++) {
			uint256 outcomeIndex = targetOutcomeIndexes[i];
			uint248 targetUniverseId = _getChildUniverseId(universeId, outcomeIndex);
			IQuestionLedger targetPool = canonicalQuestionLedgerByUniverse[targetUniverseId];
			if (address(targetPool) == address(0x0)) {
				require(targetOutcomeIndexesLength == 1, 'ShareToken bulk migration requires canonical child pools');
				forker.createChildUniverse(sourcePool, outcomeIndex);
				targetPool = canonicalQuestionLedgerByUniverse[targetUniverseId];
			}
			require(address(targetPool) != address(0x0) && (address(targetPool.parent()) == address(sourcePool) || sourcePool.portfolioCustody() != address(0)), 'ShareToken destination is missing a canonical child pool');
			targetUniverseIds[i] = targetUniverseId;
		}

		bool migratedAnyShares;
		for (uint256 i = 0; i < targetOutcomeIndexesLength; i++) {
			uint248 targetUniverseId = targetUniverseIds[i];
			uint256 alreadyMigratedAttoShares = migratedShareAmountAttoShares[fromId][targetUniverseId][msg.sender];
			require(alreadyMigratedAttoShares <= fromIdBalanceAttoShares, 'ShareToken migrated amount exceeds source balance');
			uint256 amountAttoShares = fromIdBalanceAttoShares - alreadyMigratedAttoShares;
			if (amountAttoShares == 0) continue;
			migratedShareAmountAttoShares[fromId][targetUniverseId][msg.sender] = fromIdBalanceAttoShares;
			sourceAccounts[fromId][msg.sender].balanceLocked = true;
			migratedAnyShares = true;
			uint256 toId = getChildId(fromId, targetUniverseId);
			_mint(msg.sender, toId, amountAttoShares);
			emit Migrate(msg.sender, fromId, toId, amountAttoShares);
		}
		require(migratedAnyShares, 'ShareToken has no new shares to migrate');
	}

	/// @notice Unspent recovery rights in Invalid, Yes, No order, including independently received rights.
	function balanceOfPortfolioRecoveryRights(uint248 sourceUniverse, address holder) external view returns (uint256[3] memory amountsAttoShares) {
		if (!isPortfolioRecoveryEligible(sourceUniverse)) return amountsAttoShares;
		for (uint8 outcome; outcome < Constants.NUM_OUTCOMES; outcome++) {
			uint256 id = TokenId.getTokenId(sourceUniverse, BinaryOutcomes.BinaryOutcome(outcome));
			amountsAttoShares[outcome] =
				balanceOf(holder, id) -
				sourceAccounts[id][holder].recoverySourceSpent +
				sourceAccounts[id][holder].recoveryCredits;
		}
	}

	/// @notice Final claims keep ordinary redemption and cannot detach source recovery rights.
	function isPortfolioRecoveryEligible(uint248 sourceUniverse) public view returns (bool) {
		IQuestionLedger source = canonicalQuestionLedgerByUniverse[sourceUniverse];
		if (
			address(source) == address(0) ||
			source.portfolioCustody() == address(0) ||
			zoltar.getForkTime(sourceUniverse) == 0
		) return false;
		IShareTokenPortfolioForkAuthority portfolio = IShareTokenPortfolioForkAuthority(source.securityPoolFactory().getSecurityPoolPortfolio(source));
		SecurityPoolPortfolioSettlement settlement = portfolio.settlement();
		return
			settlement.ledger().hasLiveForkRecoveryRight(settlement.bookIds(sourceUniverse), source.questionId(), portfolio.forkPortfolioTime(sourceUniverse));
	}

	/// @notice Transfer only the caller's recovery rights; all source and child share balances stay intact.
	function transferPortfolioRecoveryRights(uint248 sourceUniverse, address recipient, uint256[3] calldata amountsAttoShares) external {
		_requirePortfolioRecoverySource(sourceUniverse);
		require(recipient != address(0) && recipient != msg.sender, 'Recovery recipient must be another nonzero account');
		bool transferred;
		for (uint8 outcome; outcome < Constants.NUM_OUTCOMES; outcome++) {
			uint256 amount = amountsAttoShares[outcome];
			if (amount == 0) continue;
			transferred = true;
			uint256 id = TokenId.getTokenId(sourceUniverse, BinaryOutcomes.BinaryOutcome(outcome));
			_spendPortfolioRecoveryRights(id, msg.sender, amount, 'Insufficient recovery rights');
			sourceAccounts[id][recipient].recoveryCredits += amount;
		}
		require(transferred, 'Recovery transfer amount is zero');
		emit PortfolioRecoveryRightsTransferred(sourceUniverse, msg.sender, recipient, amountsAttoShares);
	}

	function _requirePortfolioRecoverySource(uint248 sourceUniverse) private view returns (IQuestionLedger source) {
		source = canonicalQuestionLedgerByUniverse[sourceUniverse];
		require(address(source) != address(0) && source.portfolioCustody() != address(0), 'Recovery source is not a portfolio question');
		require(zoltar.getForkTime(sourceUniverse) != 0, 'Recovery source has not forked');
		require(isPortfolioRecoveryEligible(sourceUniverse), 'No live source recovery right');
	}

	function _spendPortfolioRecoveryRights(uint256 id, address holder, uint256 amount, string memory insufficientReason) private {
		SourceAccount storage account = sourceAccounts[id][holder];
		uint256 credits = account.recoveryCredits;
		if (amount <= credits) {
			account.recoveryCredits = credits - amount;
			return;
		}
		uint256 spent = account.recoverySourceSpent + (amount - credits);
		require(spent <= balanceOf(holder, id), insufficientReason);
		account.recoveryCredits = 0;
		account.recoverySourceSpent = spent;
		account.balanceLocked = true;
	}

	/// @notice Consume one independent recovery right per outcome, preserving every branch entitlement.
	function consumePortfolioRecoveryCompleteSets(uint248 sourceUniverse, address holder, uint256 amountAttoShares) external returns (uint256 cumulativeClaimedAttoShares) {
		IQuestionLedger source = _requirePortfolioRecoverySource(sourceUniverse);
		address portfolio = source.securityPoolFactory().getSecurityPoolPortfolio(source);
		require(msg.sender == portfolio || (portfolio.code.length != 0 && msg.sender == IShareTokenPortfolioForkAuthority(portfolio).forkController()), 'Only portfolio recovery authority');
		require(amountAttoShares != 0, 'Recovery amount is zero');
		for (uint8 outcome; outcome < Constants.NUM_OUTCOMES; outcome++) {
			uint256 id = TokenId.getTokenId(sourceUniverse, BinaryOutcomes.BinaryOutcome(outcome));
			_spendPortfolioRecoveryRights(id, holder, amountAttoShares, 'Recovery requires unclaimed complete sets');
		}
		cumulativeClaimedAttoShares = recoveredCompleteSetShares[sourceUniverse][holder] + amountAttoShares;
		recoveredCompleteSetShares[sourceUniverse][holder] = cumulativeClaimedAttoShares;
		emit PortfolioRecoveryRightsConsumed(sourceUniverse, holder, amountAttoShares, cumulativeClaimedAttoShares);
	}

	function _burn(address account, uint256 id, uint256 value) internal override {
		uint256 spent = sourceAccounts[id][account].recoverySourceSpent;
		if (spent != 0)
			require(value <= balanceOf(account, id) - spent, 'ShareToken source recovery rights already separated');
		super._burn(account, id, value);
	}

	function _burnBatch(address account, uint256[] memory ids, uint256[] memory values) internal override {
		for (uint256 i; i < ids.length; i++) {
			uint256 spent = sourceAccounts[ids[i]][account].recoverySourceSpent;
			if (spent != 0)
				require(values[i] <= balanceOf(account, ids[i]) - spent, 'ShareToken source recovery rights already separated');
		}
		super._burnBatch(account, ids, values);
	}

	function _internalTransferFrom(address from, address to, uint256 id, uint256 value, bytes memory data) internal override {
		require(!sourceAccounts[id][from].balanceLocked, 'ShareToken migrated source balance is locked');
		super._internalTransferFrom(from, to, id, value, data);
	}

	function _internalBatchTransferFrom(address from, address to, uint256[] memory ids, uint256[] memory values, bytes memory data) internal override {
		for (uint256 i = 0; i < ids.length; i++) {
			require(!sourceAccounts[ids[i]][from].balanceLocked, 'ShareToken migrated source balance is locked');
		}
		super._internalBatchTransferFrom(from, to, ids, values, data);
	}
}
