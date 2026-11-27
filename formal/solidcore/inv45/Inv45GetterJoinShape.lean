import Inv45GetterHoists
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public
set_option maxRecDepth 4096
set_option maxHeartbeats 4000000

def scalarRet := "_ret___library_ScalarOutcomes_getScalarOutcomeName_0"
def scalarArgs : List Source.Expr := (List.range 5).map (fun i => .var ("_ic_arg_" ++ toString i))
def joinInner : List Source.Stmt :=
  [.memoryVarDecl (.fixedArray 2 .uint256) "_ic_arg_0" (some payoutArgument),
   .memoryVarDecl .bytesCalldata "_ic_arg_1" (some unitArgument),
   .varDecl .uint256 "_ic_arg_2" (some (.castOp .uintCleanup 256 (getterMember 4))),
   .varDecl .int256 "_ic_arg_3" (some (.castOp .intCleanup 256 (getterMember 5))),
   .varDecl .int256 "_ic_arg_4" (some (.castOp .intCleanup 256 (getterMember 6))),
   .memoryVarDecl .bytesCalldata scalarRet none,
   .captureReturn [scalarRet] (.internalCall [scalarRet] Scalar.key scalarArgs),
   .assign (.var "_sol_hoist_0") (.var scalarRet)]
def joinBlock : Source.Stmt := .block
  [.memoryVarDecl .bytesCalldata "_sol_hoist_0" none,
   .block joinInner,.returnValues [.var "_sol_hoist_0"]]

def validSumBlock? : Source.Stmt → Option Source.Stmt
  | .block [_,_,_,.block (.ifElse _ (.block scalar) _ :: _)] =>
    match scalar.getLast? with
    | some (.block [_,_,_,.ifElse (.var "#cond1646") yes .skip]) => some yes
    | _ => none
  | _ => none

theorem exactJoinSelection : validSumBlock? getter.body=some joinBlock := by
  rw [getterSource]
  rfl
end Inv45.Public
