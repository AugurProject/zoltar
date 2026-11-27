import Inv45Model
import Inv03Bodies
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv45.MulDiv
abbrev key := "__internal___library_ScalarOutcomes_mulDiv(uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
abbrev twice (v : Pattern Source.Expr) := clean (clean v)
abbrev op := Expr_binary
abbrev negBits := Expr_unary UnaryOp_bitNot
abbrev v := wvar
abbrev zero := num 0
abbrev one := num 1
def equalZero (e : Pattern Source.Expr) := op BinaryOp_eq e zero
def sub (x y : Pattern Source.Expr) := twice (op BinaryOp_sub x y)
def mul (x y : Pattern Source.Expr) := twice (op BinaryOp_mul x y)
def div (x y : Pattern Source.Expr) := twice (op BinaryOp_div x y)
def testWord (p : Pattern Source.Expr) := Expr_ternary p one zero
def guarded (dst : String) (test val : Pattern Source.Expr) :=
  Stmt_ifElse (equalZero test) (assign dst zero) (assign dst val)
def productBlock :=
  let allOnes := twice (negBits zero)
  let remainder := clean (Expr_mulMod (v "x") (v "y") allOnes)
  let correction := testWord (op BinaryOp_lt (v "mm") (v "prod0"))
  block [decl "mm" Option_none,guarded "mm" allOnes remainder,
    assign "prod0" (mul (v "x") (v "y")),
    assign "prod1" (sub (sub (v "mm") (v "prod0")) correction)]
def remainderBlock :=
  let rem := clean (Expr_mulMod (varP "x") (varP "y") (varP "denominator"))
  let carry := testWord (op BinaryOp_gt (v "remainder") (v "prod0"))
  block [guarded "remainder" (v "denominator") rem,
    assign "prod1" (sub (v "prod1") carry),assign "prod0" (sub (v "prod0") (v "remainder"))]
def twos := clean (op BinaryOp_bitAnd (v "denominator") (twice (op BinaryOp_add (twice (negBits (v "denominator"))) one)))
def divideTwos :=
  let g := v "twos"
  let flipped := twice (op BinaryOp_add (Expr_ternary (equalZero g) zero (div (sub zero g) g)) one)
  block [guarded "denominator" g (div (v "denominator") g),guarded "prod0" g (div (v "prod0") g),assign "twos" flipped]
def compound (dst : String) (method : Pattern Source.BinaryOp) (rhs : Pattern Source.Expr) :=
  Stmt_exprStmt (Expr_assignment (Option_some method) (Option_some (ValueCleanup_uint (lit 256))) (varP dst) rhs)
def seed := clean (op BinaryOp_bitXor (mul (num 3) (v "denominator")) (num 2))
def step := compound "inverse" BinaryOp_mul (sub (num 2) (mul (v "denominator") (v "inverse")))
def narrow := Stmt_ifElse (equalZero (v "prod1")) (block [ret (div (v "prod0") (v "denominator"))]) Stmt_skip
def guard (e : Pattern Source.Expr) (msg : String) := Stmt_requireStmt e (Option_some (lit msg))
def wideOK := guard (op BinaryOp_gt (v "denominator") (v "prod1")) "mulDiv result would overflow uint256"
def allSteps := [decl "prod0" Option_none,decl "prod1" Option_none,productBlock,narrow,wideOK,
  decl "remainder" Option_none,remainderBlock,decl "twos" (Option_some twos),divideTwos,
  compound "prod0" BinaryOp_bitOr (mul (v "prod1") (v "twos")),decl "inverse" (Option_some seed)] ++
  List.replicate 6 step ++ [assign "result" (mul (v "prod0") (v "inverse"))]
def guardD := guard (op BinaryOp_gt (v "denominator") zero) "mulDiv denominator must be greater than zero"
def body := block [param "x",param "y",param "denominator",Stmt_skip,block [guardD,Stmt_unchecked (block allSteps)]]
theorem signature : Inv32Library.LinkAt model.core.table key [.word "x",.word "y",.word "denominator"] [.word "result"] body.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some body).sound _ (by native_decide))
theorem sameNewton : step.value=Inv32NewtonBody.step := rfl
end Inv45.MulDiv
