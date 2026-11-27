import Inv39WrapperTerms
open SolidCore.Solidity.Source
namespace Inv39.Auth
def hoistBytes : Stmt→Option (List Byte)
  | .block [
    .varDecl (.fixedBytes 32) "_ic_arg_0" (some (.keccak256 (.byteArray bs))),
    .varDecl .address "_ic_arg_1" (some (.var "from")),
    .varDecl .address "_ic_arg_2" (some (.var "to")),
    .varDecl .uint256 "_ic_arg_3" (some (.castOp .uintCleanup 256 (.var "value"))),
    .varDecl .uint256 "_ic_arg_4" (some (.castOp .uintCleanup 256 (.var "validAfter"))),
    .varDecl .uint256 "_ic_arg_5" (some (.castOp .uintCleanup 256 (.var "validBefore"))),
    .varDecl (.fixedBytes 32) "_ic_arg_6" (some (.var "nonce")),
    .varDecl .uint256 "_ic_arg_7" (some (.castOp .uintCleanup 8 (.var "v"))),
    .varDecl (.fixedBytes 32) "_ic_arg_8" (some (.var "r")),
    .varDecl (.fixedBytes 32) "_ic_arg_9" (some (.var "s")),
    .captureReturn [] (.internalCall [] key [.var "_ic_arg_0", .var "_ic_arg_1", .var "_ic_arg_2", .var "_ic_arg_3", .var "_ic_arg_4", .var "_ic_arg_5", .var "_ic_arg_6", .var "_ic_arg_7", .var "_ic_arg_8", .var "_ic_arg_9"])]=>if key==signedKey then some bs else none
  | _=>none
def wrapperMatches (receive_ : Bool) : Stmt→Option Stmt
  | .block [.skip,.skip,.assign (.var "value") (.castOp .uintCleanup 256 (.var "value")),.assign (.var "validAfter") (.castOp .uintCleanup 256 (.var "validAfter")),.assign (.var "validBefore") (.castOp .uintCleanup 256 (.var "validBefore")),.skip,.assign (.var "v") (.castOp .uintCleanup 8 (.var "v")),.skip,.skip,.block inner]=>match receive_,inner with
    | true,[.requireStmt (.binary .eq (.var "to") .caller) (some "ERC3009 caller must be the recipient"),call]=>some call
    | false,[call]=>some call
    | _,_=>none
  | _=>none
def wrapperCheck (receive_ : Bool) (f : FunctionDef) := match f.params,f.returns,wrapperMatches receive_ f.body with
  | [⟨"from",.address,false⟩,⟨"to",.address,false⟩,⟨"value",.uint256,false⟩,⟨"validAfter",.uint256,false⟩,⟨"validBefore",.uint256,false⟩,⟨"nonce",.fixedBytes 32,false⟩,⟨"v",.uint256,false⟩,⟨"r",.fixedBytes 32,false⟩,⟨"s",.fixedBytes 32,false⟩],[],some call=>(hoistBytes call).isSome
  | _,_,_=>false
def checkedWrap (b : Bool) := ((model.core.findFunctionByName? (publicName b)).map (wrapperCheck b))==some true
theorem wrappersEvidence : checkedWrap false && checkedWrap true := by native_decide
end Inv39.Auth
