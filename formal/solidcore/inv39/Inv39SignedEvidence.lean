import Inv39SignedTerms
open SolidCore.Solidity.Source
namespace Inv39.Auth
def paymentChecks : Stmt→Option (Expr × Expr × Stmt × Stmt × Stmt)
  | .block [.skip,.skip,.skip,.assign (.var "value") (.castOp .uintCleanup 256 (.var "value")),
    .assign (.var "validAfter") (.castOp .uintCleanup 256 (.var "validAfter")),.assign (.var "validBefore") (.castOp .uintCleanup 256 (.var "validBefore")),
    .skip,.assign (.var "v") (.castOp .uintCleanup 8 (.var "v")),.skip,.skip,
    .block [.requireStmt early (some "ERC3009 authorization not yet valid"),.requireStmt late (some "ERC3009 authorization expired"),
      .storageAlias "_ret__authorizationStorage_0" "__solidcore_uninitialized_storage_return",
      .captureReturn ["_ret__authorizationStorage_0"] (.internalCall ["_ret__authorizationStorage_0"] "__internal__authorizationStorage()#[]" []),
      .storageAliasFrom "authorizationStorage" "_ret__authorizationStorage_0",
      .requireStmt (.unary .logicalNot (.index (.index (.index (.var "authorizationStorage") (.word 1)) (.var "from")) (.var "nonce"))) (some "ERC3009 authorization already used"),
      hash,sig,.assign (.index (.index (.index (.var "authorizationStorage") (.word 1)) (.var "from")) (.var "nonce")) (.word 1),
      .emitEvent "AuthorizationUsed" [.var "from",.var "nonce"],motion]]=>some (early,late,hash,sig,motion)
  | _=>none
def innerMatch (f : InternalFunction) := match f.params,f.returns,paymentChecks f.body with
  | [⟨"typeHash",.fixedBytes 32,false⟩,⟨"from",.address,false⟩,⟨"to",.address,false⟩,⟨"value",.uint256,false⟩,⟨"validAfter",.uint256,false⟩,
    ⟨"validBefore",.uint256,false⟩,⟨"nonce",.fixedBytes 32,false⟩,⟨"v",.uint256,false⟩,⟨"r",.fixedBytes 32,false⟩,⟨"s",.fixedBytes 32,false⟩],[],
    some (early,late,hash,sig,motion)=>pureExpr early && pureExpr late && sigTerms (watchFlag "from") hash && sigTerms (watchFlag "from") sig && motionTail.test motion
  | _,_,_=>false
theorem innerEvidence : ((model.core.table.lookup? signedKey).map innerMatch)=some true := by native_decide
end Inv39.Auth
