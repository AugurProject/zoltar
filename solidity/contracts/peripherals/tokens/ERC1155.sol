// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import { IERC1155 } from '../interfaces/IERC1155.sol';

/**
* @title Standard ERC1155 token
*
* @dev Implementation of the basic standard multi-token.
* See https://eips.ethereum.org/EIPS/eip-1155
* Originally based on code by Enjin: https://github.com/enjin/erc-1155
*/
contract ERC1155 is IERC1155 {

	// Mapping from token ID to account balances
	mapping (uint256 => mapping(address => uint256)) public _balances;

	// Mapping from token ID to total supply
	mapping (uint256 => uint256) public _supplys;

	// Mapping from account to operator approvals
	mapping (address => mapping(address => bool)) public _operatorApprovals;

	constructor() {}

	/**
		@dev Get the specified address' balance for token with specified ID.

		Attempting to query the zero account for a balance will result in a revert.

		@param account The address of the token holder
		@param id ID of the token
		@return The account's balance of the token type requested
	*/
	function balanceOf(address account, uint256 id) public view virtual returns (uint256) {
		require(account != address(0), "ERC1155: balance query for the zero address");
		return _balances[id][account];
	}

	function totalSupply(uint256 id) public view returns (uint256) {
		return _supplys[id];
	}

	/**
		@dev Get the balance of multiple account/token pairs.

		If any of the query accounts is the zero account, this query will revert.

		@param accounts The addresses of the token holders
		@param ids IDs of the tokens
		@return Balances for each account and token id pair
	*/
	function balanceOfBatch(
		address[] memory accounts,
		uint256[] memory ids
	)
		public
		view
		virtual
		returns (uint256[] memory)
	{
		require(accounts.length == ids.length, "ERC1155: accounts and IDs must have same lengths");

		uint256[] memory batchBalances = new uint256[](accounts.length);

		for (uint256 i = 0; i < accounts.length; ++i) {
			require(accounts[i] != address(0), "ERC1155: some address in batch balance query is zero");
			batchBalances[i] = _balances[ids[i]][accounts[i]];
		}

		return batchBalances;
	}

	/**
	* @dev Sets or unsets the approval of a given operator.
	*
	* An operator is allowed to transfer all tokens of the sender on their behalf.
	*
	* Because an account already has operator privileges for itself, this function will revert
	* if the account attempts to set the approval status for itself.
	*
	* @param operator address to set the approval
	* @param approved representing the status of the approval to be set
	*/
	function setApprovalForAll(address operator, bool approved) external {
		require(msg.sender != operator, "ERC1155: cannot set approval status for self");
		_operatorApprovals[msg.sender][operator] = approved;
		emit ApprovalForAll(msg.sender, operator, approved);
	}

	/**
		@notice Queries the approval status of an operator for a given account.
		@param account   The account of the Tokens
		@param operator  Address of authorized operator
		@return           True if the operator is approved, false if not
	*/
	function isApprovedForAll(address account, address operator) public view returns (bool) {
		return operator == address(this) || _operatorApprovals[account][operator];
	}

	/**
		@dev Transfers `value` amount of an `id` from the `from` address to the `to` address specified.
		Caller must be approved to manage the tokens being transferred out of the `from` account.
		If `to` is a smart contract, will call `onERC1155Received` on `to` and act appropriately.
		@param from Source address
		@param to Target address
		@param id ID of the token type
		@param value Transfer amount
	*/
	function safeTransferFrom(
		address from,
		address to,
		uint256 id,
		uint256 value
	)
		external
	{
		_transferFrom(from, to, id, value);
	}

	function _transferFrom(
		address from,
		address to,
		uint256 id,
		uint256 value
	)
		internal
	{
		require(to != address(0), "ERC1155: target address must be non-zero");
		require(
			from == msg.sender || isApprovedForAll(from, msg.sender) == true,
			"ERC1155: need operator approval for 3rd party transfers"
		);

		_internalTransferFrom(from, to, id, value);
	}

	function _internalTransferFrom(
		address from,
		address to,
		uint256 id,
		uint256 value
	)
		internal
		virtual
	{
		_balances[id][from] = _balances[id][from] - value;
		_balances[id][to] = _balances[id][to] + value;

		emit TransferSingle(msg.sender, from, to, id, value);
	}

	/**
		@dev Transfers `values` amount(s) of `ids` from the `from` address to the
		`to` address specified. Caller must be approved to manage the tokens being
		transferred out of the `from` account. If `to` is a smart contract, will
		call `onERC1155BatchReceived` on `to` and act appropriately.
		@param from Source address
		@param to Target address
		@param ids IDs of each token type
		@param values Transfer amounts per token type
	*/
	function safeBatchTransferFrom(
		address from,
		address to,
		uint256[] calldata ids,
		uint256[] calldata values
	)
		external
	{
		_batchTransferFrom(from, to, ids, values);
	}

	function _batchTransferFrom(
		address from,
		address to,
		uint256[] memory ids,
		uint256[] memory values
	)
		internal
	{
		require(ids.length == values.length, "ERC1155: IDs and values must have same lengths");
		if (ids.length == 0) {
			return;
		}
		require(to != address(0), "ERC1155: target address must be non-zero");
		require(
			from == msg.sender || isApprovedForAll(from, msg.sender) == true,
			"ERC1155: need operator approval for 3rd party transfers"
		);

		_internalBatchTransferFrom(from, to, ids, values);
	}

	function _internalBatchTransferFrom(
		address from,
		address to,
		uint256[] memory ids,
		uint256[] memory values
	)
		internal
		virtual
	{
		for (uint256 i = 0; i < ids.length; ++i) {
			uint256 id = ids[i];
			uint256 value = values[i];

			_balances[id][from] = _balances[id][from] - value;
			_balances[id][to] = _balances[id][to] + value;
		}

		emit TransferBatch(msg.sender, from, to, ids, values);
	}

	/**
	* @dev Internal function to mint an amount of a token with the given ID
	* @param to The address that will own the minted token
	* @param id ID of the token to be minted
	* @param value Amount of the token to be minted
	*/
	function _mint(address to, uint256 id, uint256 value) internal virtual {
		require(to != address(0), "ERC1155: mint to the zero address");

		_balances[id][to] = _balances[id][to] + value;
		_supplys[id] = _supplys[id] + value;

		emit TransferSingle(msg.sender, address(0), to, id, value);
	}

	/**
	* @dev Internal function to batch mint amounts of tokens with the given IDs
	* @param to The address that will own the minted token
	* @param ids IDs of the tokens to be minted
	* @param values Amounts of the tokens to be minted
	*/
	function _mintBatch(address to, uint256[] memory ids, uint256[] memory values) internal virtual {
		require(to != address(0), "ERC1155: batch mint to the zero address");
		require(ids.length == values.length, "ERC1155: minted IDs and values must have same lengths");

		for (uint i = 0; i < ids.length; i++) {
			_balances[ids[i]][to] = values[i] + _balances[ids[i]][to];
			_supplys[ids[i]] = _supplys[ids[i]] + values[i];
		}

		emit TransferBatch(msg.sender, address(0), to, ids, values);
	}

	/**
	* @dev Internal function to burn an amount of a token with the given ID
	* @param account Account which owns the token to be burnt
	* @param id ID of the token to be burnt
	* @param value Amount of the token to be burnt
	*/
	function _burn(address account, uint256 id, uint256 value) internal virtual {
		require(account != address(0), "ERC1155: attempting to burn tokens on zero account");

		_balances[id][account] = _balances[id][account] - value;
		_supplys[id] = _supplys[id] - value;
		emit TransferSingle(msg.sender, account, address(0), id, value);
	}

	/**
	* @dev Internal function to batch burn an amounts of tokens with the given IDs
	* @param account Account which owns the token to be burnt
	* @param ids IDs of the tokens to be burnt
	* @param values Amounts of the tokens to be burnt
	*/
	function _burnBatch(address account, uint256[] memory ids, uint256[] memory values) internal virtual {
		require(account != address(0), "ERC1155: attempting to burn batch of tokens on zero account");
		require(ids.length == values.length, "ERC1155: burnt IDs and values must have same lengths");

		for (uint i = 0; i < ids.length; i++) {
			_balances[ids[i]][account] = _balances[ids[i]][account] - values[i];
			_supplys[ids[i]] = _supplys[ids[i]] - values[i];
		}

		emit TransferBatch(msg.sender, account, address(0), ids, values);
	}
}
