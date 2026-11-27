import Inv39CancelTerms
open SolidCore.Solidity.Source
namespace Inv39.Auth
def matchesCancelBody : Stmt→Option (Stmt × Stmt)
  | .block [.skip,.skip,.assign (.var "v") (.castOp .uintCleanup 8 (.var "v")),.skip,.skip,
    .block [.storageAlias "_ret__authorizationStorage_0" "__solidcore_uninitialized_storage_return",
      .captureReturn ["_ret__authorizationStorage_0"] (.internalCall ["_ret__authorizationStorage_0"] "__internal__authorizationStorage()#[]" []),
      .storageAliasFrom "authorizationStorage" "_ret__authorizationStorage_0",
      .requireStmt (.unary .logicalNot (.index (.index (.index (.var "authorizationStorage") (.word 1)) (.var "authorizer")) (.var "nonce"))) (some "ERC3009 authorization already used"),
      hash,sig,.assign (.index (.index (.index (.var "authorizationStorage") (.word 1)) (.var "authorizer")) (.var "nonce")) (.word 1),
      .emitEvent "AuthorizationCanceled" [.var "authorizer",.var "nonce"]]]=>some (hash,sig)
  | _=>none
def certifiesCancel (f : FunctionDef) : Bool := match f.params,f.returns,matchesCancelBody f.body with
  | [⟨"authorizer",.address,false⟩,⟨"nonce",.fixedBytes 32,false⟩,⟨"v",.uint256,false⟩,⟨"r",.fixedBytes 32,false⟩,⟨"s",.fixedBytes 32,false⟩],[],some (hash,sig)=>
    sigTerms (watchFlag "authorizer") hash && sigTerms (watchFlag "authorizer") sig
  | _,_,_=>false
theorem cancelEvidence : ((model.core.findFunctionByName? "cancelAuthorization").map certifiesCancel)=some true := by native_decide
end Inv39.Auth
