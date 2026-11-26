import Inv45FormatterCall
import Inv45Interpolation
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Scalar
open Bytes
abbrev key := "__internal___library_ScalarOutcomes_getScalarOutcomeName(uint120[2],string,uint256,int256,int256)#[SolidCore.Solidity.Ty.array (SolidCore.Solidity.Ty.uint 120) (some 2),\n SolidCore.Solidity.Ty.string,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.int 256,\n SolidCore.Solidity.Ty.int 256]"
abbrev mulSlot := "_ret___library_ScalarOutcomes_mulDiv_0"
abbrev addSlot := "_ret___library_ScalarOutcomes_addInt256Uint256_0"
abbrev formatSlot := "_ret___library_ScalarOutcomes_intToDecimalString_0"
def locPayout : Pattern Source.Stmt where
  value:=.memoryLocalize (.fixedArray 2 .uint256) "payoutNumerators"
  test | .memoryLocalize (.fixedArray 2 .uint256) "payoutNumerators"=>true | _=>false
  sound v h:=by split at h <;> simp_all
def sVar (name : String) := Shapes.signedCast (varP name)
def uVar (name : String) := clean (Add.uintConvert (varP name))
def payout := clean (Add.uintConvert (index (varP "payoutNumerators") (num 1)))
def rawDiff := MulDiv.sub (uVar "maxValue") (uVar "minValue")
def diff := Stmt_unchecked (block [Inv03.Bodies.assign "diffU" rawDiff])
def ticks := MulDiv.guard (Expr_binary BinaryOp_gt (wvar "numTicks") (num 0)) "Scalar question numTicks must be positive"
def range := MulDiv.guard (Expr_binary BinaryOp_gt (sVar "maxValue") (sVar "minValue")) "Scalar question display max must be greater than display min"
def mul := Inv03.Bodies.hoist MulDiv.key mulSlot [("_ic_arg_0",wvar "payout"),("_ic_arg_1",wvar "diffU"),("_ic_arg_2",wvar "numTicks")]
def sint (name : String) (e : Pattern (Option Source.Expr)) := Stmt_varDecl Add.intTy (lit name) e
def add := block [sint "_ic_arg_0" (Option_some (sVar "minValue")),Add.fromVar "_ic_arg_1" (wvar "scalarValueU"),sint addSlot Option_none,
  Format.callBytes addSlot Add.key ["_ic_arg_0","_ic_arg_1"],Inv03.Bodies.assign Format.temp0 (varP addSlot)]
def precision := Expr_ternary (num 1) (num 18) (num 18)
def formatValue := block [sint "_ic_arg_0" (Option_some (sVar "scalarValue")),Add.fromVar "_ic_arg_1" precision,
  Format.blank formatSlot,Format.callBytes formatSlot Format.key ["_ic_arg_0","_ic_arg_1"],Inv03.Bodies.assign Format.temp0 (varP formatSlot)]
def numericSteps := [ticks,range,Add.fromVar "payout" payout,decl "diffU" Option_none,diff,decl Format.temp0 Option_none,mul,
  Add.fromVar "scalarValueU" (wvar Format.temp0),sint Format.temp0 Option_none,add,sint "scalarValue" (Option_some (sVar Format.temp0))]
def neZero (e : Pattern Source.Expr) := Expr_binary (⟨.ne,(fun | .ne=>true | _=>false),by intro v h;cases v <;> simp_all⟩) e (num 0)
def addUnit := Inv03.Bodies.assign "label" (pack [varP "label",Decimal.bytesLiteral [32],varP "unit"])
def withUnit := Stmt_ifElse (neZero (size "unit")) addUnit Stmt_skip
def tagCond := Inv08.Authority.both (Expr_binary BinaryOp_lt (wvar "diffU") (wvar "numTicks"))
  (neZero (clean (Expr_mulMod (varP "payout") (varP "diffU") (varP "numTicks"))))
def tickOf := block [Add.fromVar "_ic_arg_0" (wvar "numTicks"),Format.blank Format.decimalSlot,
  Format.callBytes Format.decimalSlot Decimal.key ["_ic_arg_0"],Inv03.Bodies.assign Format.temp1 (varP Format.decimalSlot)]
def textBytes (name : String) (s : List Nat) := Decimal.mem name (Option_some (Decimal.bytesLiteral s))
def suffixDst := pack [varP "_sol_hoist_4",varP "_sol_hoist_3",varP Format.temp0,varP "_sol_hoist_2",varP Format.temp1,Decimal.bytesLiteral [41]]
def tagSteps := [aliasBytes "_sol_hoist_4" "label",textBytes "_sol_hoist_3" [32,40,116,105,99,107,32],Format.blank Format.temp0,
  Format.decimalHoist "payout",textBytes "_sol_hoist_2" [32,111,102,32],Format.blank Format.temp1,tickOf,Inv03.Bodies.assign "label" suffixDst]
def textSteps := [Format.blank Format.temp0,formatValue,aliasBytes "label" Format.temp0,withUnit,Stmt_ifElse tagCond (block tagSteps) Stmt_skip,ret (varP "label")]
def body := block [locPayout,localize "unit",param "numTicks",Inv03.Bodies.assign "minValue" (sVar "minValue"),
  Inv03.Bodies.assign "maxValue" (sVar "maxValue"),Decimal.initRet,block (numericSteps++textSteps)]
def fn? := model.core.table.lookup? key
theorem present : fn?.isSome := by native_decide
def fn := fn?.get present
theorem source : fn.body=body.value := body.sound _ (by native_decide)
end Inv45.Scalar
