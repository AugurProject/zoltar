import Inv45Calls
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv45.Add
abbrev key := "__internal___library_ScalarOutcomes_addInt256Uint256(int256,uint256)#[SolidCore.Solidity.Ty.int 256, SolidCore.Solidity.Ty.uint 256]"
abbrev magSlot := "_ret___library_ScalarOutcomes_absoluteInt256_0"
abbrev temp := "_sol_hoist_0"
def intTy : Pattern Source.Ty where
  value:=.int256
  test | .int256=>true | _=>false
  sound v h:= by split at h <;> simp_all
def intConvert (e : Pattern Source.Expr) :=
  Expr_castOp (⟨.intCast,(fun | .intCast=>true | _=>false),by intro v h;cases v <;> simp_all⟩) (lit 256) e
def uintConvert := Expr_castOp CastKind_uintCast (lit 256)
def fromVar (n : String) (e : Pattern Source.Expr) := decl n (Option_some e)
abbrev max := clean (uintConvert (Shapes.signedLiteral (Signed.H-1)))
def limited (lhs rhs : Pattern Source.Expr) (msg : String) := MulDiv.guard (Expr_binary BinaryOp_le lhs rhs) msg
def extra (l r : Pattern Source.Expr) := MulDiv.twice (Expr_binary BinaryOp_add l r)
def posGuard := block [fromVar "#operand272" (wvar "addend"),fromVar "#operand280" max,fromVar "#operand281" (wvar "valueU"),
  fromVar "#operand282" (MulDiv.sub (wvar "#operand280") (wvar "#operand281")),
  limited (wvar "#operand272") (wvar "#operand282") "Scalar value addition exceeds int256 maximum"]
def posSum := Shapes.signedCast (Shapes.signedCast (MulDiv.twice (extra (wvar "valueU") (wvar "addend"))))
def first := Stmt_ifElse Shapes.nonnegative (block [fromVar "valueU" Shapes.positive,posGuard,ret posSum]) Stmt_skip
def hoist := block [Stmt_varDecl intTy (lit "_ic_arg_0") (Option_some (Shapes.signedCast (varP "value"))),
  decl magSlot Option_none, Stmt_captureReturn (seq [lit magSlot]) (Stmt_internalCall (seq [lit magSlot]) (lit Shapes.absoluteKey)
    (seq [varP "_ic_arg_0"])),assign temp (varP magSlot)]
def cross := Stmt_ifElse (Shapes.ge (wvar "addend") (wvar "absoluteValue"))
  (block [fromVar "positiveValue" (MulDiv.sub (wvar "addend") (wvar "absoluteValue")),
    limited (wvar "positiveValue") max "Scalar value positive result exceeds int256 maximum",
    ret (Shapes.signedCast (intConvert (varP "positiveValue")))]) Stmt_skip
def bounds (amount limit added : String) (last : Pattern Source.Stmt) :=
  block [fromVar amount (wvar "negativeValue"),fromVar limit max,fromVar added (extra (wvar limit) (num 1)),last]
def negCheck := bounds "#operand339" "#operand347" "#operand349"
  (limited (wvar "#operand339") (wvar "#operand349") "Scalar value negative result exceeds int256 minimum")
def minCheck := bounds "#operand354" "#operand362" "#operand364" (Stmt_ifElse (Expr_binary BinaryOp_eq (wvar "#operand354") (wvar "#operand364"))
  (ret (Shapes.signedCast (Shapes.signedLiteral Signed.H))) Stmt_skip)
def negRet := Shapes.signedCast (Shapes.negative (intConvert (varP "negativeValue")))
def actions := [first,decl temp Option_none,hoist,fromVar "absoluteValue" (wvar temp),cross,
  fromVar "negativeValue" (MulDiv.sub (wvar "absoluteValue") (wvar "addend")),negCheck,minCheck,ret negRet]
def body := block [assign "value" (Shapes.signedCast (varP "value")),param "addend",Stmt_skip,block actions]
def fn? := model.core.table.lookup? key
theorem existsFn : fn?.isSome := by native_decide
def fn := fn?.get existsFn
theorem source : fn.body=body.value := body.sound _ (by native_decide)
private def sig : List BindingDecl → List BindingDecl → Bool
  | [⟨"value",.int256,false⟩,⟨"addend",.uint256,false⟩],[⟨"_ret0",.int256,false⟩] => true
  | _,_ => false
theorem signature : fn.params=[⟨"value",.int256,false⟩,⟨"addend",.uint256,false⟩] ∧ fn.returns=[⟨"_ret0",.int256,false⟩] := by
  have h : sig fn.params fn.returns := by native_decide
  generalize fn.params=ps at *;generalize fn.returns=rs at *
  unfold sig at h;split at h <;> simp_all
end Inv45.Add
