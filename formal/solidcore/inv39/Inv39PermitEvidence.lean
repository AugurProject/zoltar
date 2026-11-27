import Inv39PermitTerms
open SolidCore.Solidity.Source
namespace Inv39.Auth
def readPermit : Stmt→Option (Expr × Stmt × Stmt × Stmt)
  | .block [.skip,.skip,.assign (.var "value") (.castOp .uintCleanup 256 (.var "value")),
    .assign (.var "deadline") (.castOp .uintCleanup 256 (.var "deadline")),.assign (.var "v") (.castOp .uintCleanup 8 (.var "v")),.skip,.skip,
    .block [.requireStmt deadline (some "ERC2612 permit expired"),.storageAlias "_ret__authorizationStorage_0" "__solidcore_uninitialized_storage_return",
      .captureReturn ["_ret__authorizationStorage_0"] (.internalCall ["_ret__authorizationStorage_0"] "__internal__authorizationStorage()#[]" []),
      .storageAliasFrom "authorizationStorage" "_ret__authorizationStorage_0",
      .varDecl .uint256 "nonce" (some (.incDec .add true (some (.uint 256)) (.index (.index (.var "authorizationStorage") (.word 0)) (.var "owner")))),
      hash,sig,approval]]=>some (deadline,hash,sig,approval)
  | _=>none
def checkPermit (f : FunctionDef) := match f.params,f.returns,readPermit f.body with
  | [⟨"owner",.address,false⟩,⟨"spender",.address,false⟩,⟨"value",.uint256,false⟩,⟨"deadline",.uint256,false⟩,⟨"v",.uint256,false⟩,
    ⟨"r",.fixedBytes 32,false⟩,⟨"s",.fixedBytes 32,false⟩],[],some (deadline,hash,sig,approval)=>
    pureExpr deadline && sigTerms permitWatch hash && sigTerms permitWatch sig && grant.test approval
  | _,_,_=>false
theorem permitEvidence : ((model.core.findFunctionByName? "permit").map checkPermit)=some true := by native_decide
end Inv39.Auth
