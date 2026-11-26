import Inv39MarkerExecution
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Init.Marker
namespace ActualSuffix
def hoist := "_sol_hoist_0"
def ret := "_ret___library_DecimalStrings_toString_0"
def arg := "_ic_arg_0"
def namePrefix : List Nat := [65,117,103,117,114,32,82,101,112,117,116,97,116,105,111,110,32]
def packed (bs : List Nat) : Source.Expr := .encode .packed none [0,0] [.bytesCalldata,.bytesCalldata] [.byteArray bs,.var "number"]
def conversion : Source.Stmt := .block [
  .varDecl .uint256 arg (some repValue),
  .memoryVarDecl .bytesCalldata ret none,
  .captureReturn [ret] (.internalCall [ret] Decimal.key [.var arg]),
  .assign (.var hoist) (.var ret)]
def tail : List Source.Stmt := [
  .memoryVarDecl .bytesCalldata "number" (some (.var hoist)),
  .assign (.storage "_name") (packed namePrefix),
  .assign (.storage "_symbol") (packed [82,69,80]),
  .assign (.storage "totalTheoreticalSupplyAttoRep") (.castOp .uintCleanup 256 (.var "totalTheoreticalSupplyAttoRep_")),
  .emitEvent "TheoreticalSupplySet" [.storageRead .load "totalTheoreticalSupplyAttoRep" []],
  .emitEvent "ReputationTokenInitialized" [.var "universeId_",.var "repNumber_",.storageRead .load "_name" [],.storageRead .load "_symbol" [],.var "totalTheoreticalSupplyAttoRep_"]]
def value : List Source.Stmt := .memoryVarDecl .bytesCalldata hoist none :: conversion :: tail
def syntaxTest : List Source.Stmt → Bool
  | [.memoryVarDecl .bytesCalldata "_sol_hoist_0" none,
      .block [.varDecl .uint256 "_ic_arg_0" (some (.castOp .uintCleanup 256 (.var "repNumber_"))),
        .memoryVarDecl .bytesCalldata "_ret___library_DecimalStrings_toString_0" none,
        .captureReturn ["_ret___library_DecimalStrings_toString_0"]
          (.internalCall ["_ret___library_DecimalStrings_toString_0"]
            "__internal___library_DecimalStrings_toString(uint256)#[SolidCore.Solidity.Ty.uint 256]" [.var "_ic_arg_0"]),
        .assign (.var "_sol_hoist_0") (.var "_ret___library_DecimalStrings_toString_0")],
      .memoryVarDecl .bytesCalldata "number" (some (.var "_sol_hoist_0")),
      .assign (.storage "_name") (.encode .packed none [0,0] [.bytesCalldata,.bytesCalldata]
        [.byteArray [65,117,103,117,114,32,82,101,112,117,116,97,116,105,111,110,32],.var "number"]),
      .assign (.storage "_symbol") (.encode .packed none [0,0] [.bytesCalldata,.bytesCalldata]
        [.byteArray [82,69,80],.var "number"]),
      .assign (.storage "totalTheoreticalSupplyAttoRep") (.castOp .uintCleanup 256 (.var "totalTheoreticalSupplyAttoRep_")),
      .emitEvent "TheoreticalSupplySet" [.storageRead .load "totalTheoreticalSupplyAttoRep" []],
      .emitEvent "ReputationTokenInitialized" [.var "universeId_",.var "repNumber_",.storageRead .load "_name" [],.storageRead .load "_symbol" [],.var "totalTheoreticalSupplyAttoRep_"]] => true
  | _ => false
theorem matchesSound (ss : List Source.Stmt) (h : syntaxTest ss=true) : ss=value := by
  unfold syntaxTest at h
  split at h <;> first | rfl | contradiction
theorem tested : ((model.core.findFunctionByName? "initialize").bind fun f =>
    (Repeat.extract f.body).bind extractSites).map (fun x => syntaxTest x.2.2.2.2) = some true := by native_decide
end ActualSuffix
end Inv39.Init.Marker
