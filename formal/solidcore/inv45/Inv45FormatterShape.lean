import Inv45Pack
import Inv45TrimCopy
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Format
open Bytes
abbrev key := "__internal___library_ScalarOutcomes_intToDecimalString(int256,uint256)#[SolidCore.Solidity.Ty.int 256, SolidCore.Solidity.Ty.uint 256]"
abbrev decimalSlot := "_ret___library_DecimalStrings_toString_0"
abbrev padSlot := "_ret___library_ScalarOutcomes_zeroPadLeft_0"
abbrev temp0 := "_sol_hoist_0"
abbrev temp1 := "_sol_hoist_1"
def power : Pattern Source.BinaryOp where
  value:=.exp
  test | .exp=>true | _=>false
  sound v h:=by cases v <;> simp_all
def neg := Expr_binary BinaryOp_lt (Shapes.signedCast (varP "value")) (Shapes.signedLiteral 0)
def declareNeg := Stmt_varDecl Ty_bool (lit "isNegative") (Option_some neg)
def makeBase := MulDiv.twice (Expr_binary power (num 10) (wvar "decimals"))
def part (integer : Bool) := MulDiv.twice (Expr_binary (if integer then BinaryOp_div else BinaryOp_mod) (wvar "absoluteValue") (wvar "base"))
def blank (name : String) := Decimal.mem name Option_none
def callBytes (slot key : String) (args : List String) :=
  Stmt_captureReturn (seq [lit slot]) (Stmt_internalCall (seq [lit slot]) (lit key) (seq (args.map varP)))
def decimalHoist (input : String) :=
  block [Add.fromVar "_ic_arg_0" (wvar input),blank decimalSlot,callBytes decimalSlot Decimal.key ["_ic_arg_0"],assign temp0 (varP decimalSlot)]
def padHoist := block [aliasBytes "_ic_arg_0" temp0,Add.fromVar "_ic_arg_1" (wvar "decimals"),blank padSlot,
  callBytes padSlot Pad.key ["_ic_arg_0","_ic_arg_1"],assign temp1 (varP padSlot)]
def sign (name : String) := Stmt_ifElse (varP "isNegative")
  (ret (pack [Decimal.bytesLiteral [45],varP name])) (ret (varP name))
def integerExit := Stmt_ifElse (MulDiv.equalZero (wvar "fractionalPart")) (sign "integerString") Stmt_skip
def fraction := [blank temp0,decimalHoist "fractionalPart",blank temp1,padHoist,aliasBytes "fractionalBytes" temp1,
  Add.fromVar "trimIndex" (size "fractionalBytes"),Trim.loop,allocatedBytes "trimmed" "trimIndex",Trim.prefixCopy,
  Decimal.mem "result" (Option_some (pack [varP "integerString",Decimal.bytesLiteral [46],varP "trimmed"])),sign "result"]
def integerSteps := [declareNeg,decl temp0 Option_none,Add.hoist,Add.fromVar "absoluteValue" (wvar temp0),Add.fromVar "base" makeBase,
  Add.fromVar "integerPart" (part true),Add.fromVar "fractionalPart" (part false),blank temp0,decimalHoist "integerPart",
  aliasBytes "integerString" temp0,integerExit]
def body := block [assign "value" (Shapes.signedCast (varP "value")),param "decimals",Decimal.initRet,block (integerSteps++fraction)]
def fn? := model.core.table.lookup? key
theorem present : fn?.isSome := by native_decide
def fn := fn?.get present
theorem source : fn.body=body.value := body.sound _ (by native_decide)
private def sig : List BindingDecl→List BindingDecl→Bool
  | [⟨"value",.int256,false⟩,⟨"decimals",.uint256,false⟩],[⟨"_ret0",.bytesCalldata,false⟩]=>true
  | _,_=>false
theorem signature : fn.params=[⟨"value",.int256,false⟩,⟨"decimals",.uint256,false⟩] ∧ fn.returns=[⟨"_ret0",.bytesCalldata,false⟩] := by
  have h : sig fn.params fn.returns := by native_decide
  generalize fn.params=ps at *;generalize fn.returns=rs at *
  unfold sig at h;split at h <;> simp_all
end Inv45.Format
