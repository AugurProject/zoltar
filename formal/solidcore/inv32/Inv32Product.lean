import Inv32ConditionalAction
import Inv32ExactMul512
open SolidCore.Solidity.Source Inv32Scalar Inv32Actions Inv32Division
namespace Inv32Product
def clean := cast .cleanup 256
def eqF := binary .eq (by intro h; cases h) (by intro h; cases h)
def ltF := binary .lt (by intro h; cases h) (by intro h; cases h)
def subF := binary .sub (by intro h; cases h) (by intro h; cases h)
def mulF := binary .mul (by intro h; cases h) (by intro h; cases h)
def largest := clean (clean (unary .bitNot (literal 0)))
def modExpr := modularProduct (clean (localWord "a")) (clean (localWord "b")) largest
def lowExpr := clean (mulF (clean (localWord "a")) (clean (localWord "b")))
def mm := clean (localWord "mm")
def low := clean (localWord "low")
def highExpr := clean (subF (clean (clean (subF mm low))) (choice (ltF mm low) (literal 1) (literal 0)))
def program := block [
  writeCast "a" .cleanup 256 (localWord "a") (by decide),
  writeCast "b" .cleanup 256 (localWord "b") (by decide),
  noop, noop,
  block [unchecked (block [declareZero "mm", conditional (eqF largest (literal 0)) (by decide)
    (writeLiteral "mm" 0) (writeCast "mm" .cleanup 256 modExpr (by decide)),
    writeCast "low" .cleanup 256 lowExpr (by decide),
    writeCast "high" .cleanup 256 highExpr (by decide)])]]

theorem exactProgram : program.core = Inv32Bodies.Mul512.body := by rfl

theorem execute (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (enough : 6 ≤ n) (h : program.run c.checked r = some next) :
    Stmt.eval n t c r Inv32Bodies.Mul512.body = pure (.normal next) :=
  exactProgram ▸ program.sound _ _ _ _ _ (le_trans (by decide) enough) h
end Inv32Product
