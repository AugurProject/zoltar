// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../../../solidity/contracts/peripherals/BinaryOutcomes.sol';
import { IERC1155Receiver } from '../../../solidity/contracts/peripherals/interfaces/IERC1155Receiver.sol';
import { ISecurityPool, SystemState } from '../../../solidity/contracts/peripherals/interfaces/ISecurityPool.sol';

contract TradingMockZoltar {
	mapping(uint248 => uint256) public forkTime;

	function getForkTime(uint248 universeId) external view returns (uint256) {
		return forkTime[universeId];
	}

	function setForkTime(uint248 universeId, uint256 value) external {
		forkTime[universeId] = value;
	}
}

contract TradingMockQuestionData {
	mapping(uint256 => uint256) public endTime;

	function getQuestionEndDate(uint256 questionId) external view returns (uint256) {
		return endTime[questionId];
	}

	function setEndTime(uint256 questionId, uint256 value) external {
		endTime[questionId] = value;
	}
}

contract TradingMockForker {
	mapping(address => BinaryOutcomes.BinaryOutcome) public outcome;

	function getQuestionOutcome(ISecurityPool pool) external view returns (BinaryOutcomes.BinaryOutcome) {
		return outcome[address(pool)];
	}

	function setQuestionOutcome(address pool, BinaryOutcomes.BinaryOutcome value) external {
		outcome[pool] = value;
	}
}

contract TradingMockShareToken {
	mapping(uint256 => mapping(address => uint256)) private balances;
	mapping(address => mapping(address => bool)) private approvals;
	mapping(uint248 => address) public canonicalPoolByUniverse;

	event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
	event TransferBatch(
		address indexed operator,
		address indexed from,
		address indexed to,
		uint256[] ids,
		uint256[] values
	);
	event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

	function setCanonicalPool(uint248 universeId, address pool) external {
		canonicalPoolByUniverse[universeId] = pool;
	}

	function getTokenId(uint248 universeId, BinaryOutcomes.BinaryOutcome outcome) public pure returns (uint256) {
		return (uint256(universeId) << 8) | uint8(outcome);
	}

	function balanceOf(address owner, uint256 id) external view returns (uint256) {
		return balances[id][owner];
	}

	function isApprovedForAll(address owner, address operator) external view returns (bool) {
		return approvals[owner][operator];
	}

	function setApprovalForAll(address operator, bool approved) external {
		approvals[msg.sender][operator] = approved;
		emit ApprovalForAll(msg.sender, operator, approved);
	}

	function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data) external {
		require(msg.sender == from || approvals[from][msg.sender], 'ERC1155 approval');
		_transfer(from, to, id, value);
		if (to.code.length > 0)
			require(
				IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, value, data) ==
					IERC1155Receiver.onERC1155Received.selector,
				'Receiver rejected'
			);
	}

	function safeBatchTransferFrom(
		address from,
		address to,
		uint256[] calldata ids,
		uint256[] calldata values,
		bytes calldata data
	) external {
		require(msg.sender == from || approvals[from][msg.sender], 'ERC1155 approval');
		require(ids.length == values.length, 'ERC1155 length');
		for (uint256 index = 0; index < ids.length; index++) _transfer(from, to, ids[index], values[index]);
		if (to.code.length > 0)
			require(
				IERC1155Receiver(to).onERC1155BatchReceived(msg.sender, from, ids, values, data) ==
					IERC1155Receiver.onERC1155BatchReceived.selector,
				'Receiver rejected'
			);
	}

	function mintCompleteSets(uint248 universeId, address account, uint256 amount) external {
		uint256[] memory ids = new uint256[](3);
		uint256[] memory values = new uint256[](3);
		for (uint256 index = 0; index < 3; index++) {
			ids[index] = (uint256(universeId) << 8) | index;
			values[index] = amount;
			balances[ids[index]][account] += amount;
		}
		emit TransferBatch(msg.sender, address(0), account, ids, values);
		if (account.code.length > 0)
			require(
				IERC1155Receiver(account).onERC1155BatchReceived(msg.sender, address(0), ids, values, '') ==
					IERC1155Receiver.onERC1155BatchReceived.selector,
				'Receiver rejected'
			);
	}

	function burnCompleteSets(uint248 universeId, address account, uint256 amount) external {
		for (uint256 index = 0; index < 3; index++) {
			uint256 id = (uint256(universeId) << 8) | index;
			require(balances[id][account] >= amount, 'ERC1155 balance');
			balances[id][account] -= amount;
		}
	}

	function mint(address account, uint256 id, uint256 amount) external {
		balances[id][account] += amount;
		emit TransferSingle(msg.sender, address(0), account, id, amount);
		if (account.code.length > 0)
			require(
				IERC1155Receiver(account).onERC1155Received(msg.sender, address(0), id, amount, '') ==
					IERC1155Receiver.onERC1155Received.selector,
				'Receiver rejected'
			);
	}

	function forceMintWithoutCallback(address account, uint256 id, uint256 amount) external {
		balances[id][account] += amount;
		emit TransferSingle(msg.sender, address(0), account, id, amount);
	}

	function _transfer(address from, address to, uint256 id, uint256 value) private {
		require(to != address(0), 'ERC1155 recipient');
		require(balances[id][from] >= value, 'ERC1155 balance');
		balances[id][from] -= value;
		balances[id][to] += value;
		emit TransferSingle(msg.sender, from, to, id, value);
	}
}

contract TradingMockCoreFactory {
	bytes32 public constant ORIGIN_ID = keccak256('trading-test-origin');
	mapping(address => bytes32) public originByPool;
	mapping(bytes32 => mapping(uint248 => address)) public poolByOriginAndUniverse;

	function setPool(address pool, uint248 universeId) external {
		originByPool[pool] = ORIGIN_ID;
		poolByOriginAndUniverse[ORIGIN_ID][universeId] = pool;
	}

	function getSecurityPoolOriginId(ISecurityPool pool) external view returns (bytes32) {
		return originByPool[address(pool)];
	}

	function getSecurityPool(bytes32 originId, uint248 universeId) external view returns (ISecurityPool) {
		return ISecurityPool(payable(poolByOriginAndUniverse[originId][universeId]));
	}
}

contract TradingMockSecurityPool {
	uint248 public immutable universeId;
	uint256 public immutable questionId;
	TradingMockShareToken public immutable shareToken;
	TradingMockCoreFactory public immutable securityPoolFactory;
	TradingMockZoltar public immutable zoltar;
	TradingMockQuestionData public immutable questionData;
	TradingMockForker public immutable securityPoolForker;
	SystemState public systemState = SystemState.Operational;
	bool public awaitingForkContinuation;
	uint256 public sharesPerEth;
	uint256 public shareTokenSupplyAttoShares;
	uint256 public settlementCollateralAttoEth;

	constructor(
		TradingMockShareToken token,
		TradingMockCoreFactory coreFactory,
		TradingMockZoltar mockZoltar,
		TradingMockQuestionData mockQuestionData,
		TradingMockForker mockForker,
		uint248 mockUniverseId,
		uint256 mockQuestionId,
		uint256 initialSharesPerEth
	) {
		shareToken = token;
		securityPoolFactory = coreFactory;
		zoltar = mockZoltar;
		questionData = mockQuestionData;
		securityPoolForker = mockForker;
		universeId = mockUniverseId;
		questionId = mockQuestionId;
		sharesPerEth = initialSharesPerEth;
	}

	function setSharesPerEth(uint256 value) external {
		require(value > 0, 'Rate is zero');
		sharesPerEth = value;
	}

	function setSystemState(SystemState value) external {
		systemState = value;
	}

	function setAwaitingForkContinuation(bool value) external {
		awaitingForkContinuation = value;
	}

	function attoEthToAttoShares(uint256 amountAttoEth) public view returns (uint256) {
		return amountAttoEth * sharesPerEth;
	}

	function attoSharesToAttoEth(uint256 amountAttoShares) public view returns (uint256) {
		return amountAttoShares / sharesPerEth;
	}

	function createCompleteSet() external payable {
		uint256 amount = attoEthToAttoShares(msg.value);
		require(amount > 0, 'Mint is zero');
		shareTokenSupplyAttoShares += amount;
		settlementCollateralAttoEth += msg.value;
		shareToken.mintCompleteSets(universeId, msg.sender, amount);
	}

	function redeemCompleteSet(uint256 amount) external {
		uint256 ethAmount = attoSharesToAttoEth(amount);
		shareToken.burnCompleteSets(universeId, msg.sender, amount);
		shareTokenSupplyAttoShares -= amount;
		settlementCollateralAttoEth -= ethAmount;
		(bool success, ) = payable(msg.sender).call{ value: ethAmount }('');
		require(success, 'ETH transfer');
	}

	receive() external payable {}
}

contract TradingForceEth {
	constructor() payable {}

	function force(address payable recipient) external {
		selfdestruct(recipient);
	}
}

contract TradingReentrantRecipient is IERC1155Receiver {
	address public target;
	bytes public payload;
	bool public reentryBlocked;

	function configure(address valueTarget, bytes calldata valuePayload) external {
		target = valueTarget;
		payload = valuePayload;
		reentryBlocked = false;
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC1155Receiver).interfaceId;
	}

	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
		_attemptReentry();
		return IERC1155Receiver.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(
		address,
		address,
		uint256[] calldata,
		uint256[] calldata,
		bytes calldata
	) external returns (bytes4) {
		_attemptReentry();
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	function _attemptReentry() private {
		(bool success, ) = target.call(payload);
		require(!success, 'Reentry unexpectedly succeeded');
		reentryBlocked = true;
	}
}
