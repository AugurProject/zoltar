import Inv32RatioLoop
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Actions Inv32QuoteExpr Inv32RatioTest Inv32FloorStart
namespace Inv32RatioNarrow
abbrev operand0 := "#operand3764"
abbrev operand1 := "#operand3769"
abbrev operand2 := "#operand3770"
abbrev operand3 := "#operand3771"
def maxWord := Inv32Product.clean (literal (R-1))
def diff := nonnegativeSub (w operand1) (w operand2)
def add := Inv32Midpoint.plus (w "otherPart") (w "numeratorPart")
def le := Inv32WideGuards.leF (w operand0) (w operand3)
def floor := Inv32FloorHoist.code flag (w "scale").core (w "numeratorPart").core add.core
def early := Stmt.block [.varDecl .uint256 flag none,floor,.returnValues [(castCopy flag).core]]
def test := Stmt.block [temp operand0 "otherPart",.varDecl .uint256 operand1 (some maxWord.core),temp operand2 "numeratorPart",
  .varDecl .uint256 operand3 (some diff.core),.ifElse le.core early .skip]
theorem location : Inv32RatioStep.ss[0]? = some test := by rfl
def withOps (r : Runtime) (p o : Nat) :=
  let x := r.pushScope.declareLocal operand0 (.word o)
  let y := x.declareLocal operand1 (.word (R-1))
  let z := y.declareLocal operand2 (.word p)
  z.declareLocal operand3 (.word (R-1-p))
theorem earlyExec (n : Nat) (c : Context) (r : Runtime) (s p o : Nat) (hs : s<R) (hp : p<R) (ho : o<R)
    (positive : 0<o+p) (fits : o+p<R) (ch : c.checked=true) :
    let pre := withOps (root r s p o) p o
    Stmt.eval (n+16) Inv32Dispatch.model.core.table c pre early =
      pure (.returned pre [.word (Inv32RatioLoop.answer s p o)]) := by
  let t := Inv32Dispatch.model.core.table
  let pre := withOps (root r s p o) p o
  let inside := pre.pushScope
  let q := Inv32RatioLoop.answer s p o
  have qr : q<R := lt_of_le_of_lt (Inv32RatioLoop.bound s p o positive) hs
  have args : Inv32FloorHoist.Inputs c inside flag (w "scale").core (w "numeratorPart").core add.core s p (o+p) := by
    refine ⟨Inv32Guards.clean _ _ _ _ _ hs (Inv32Guards.readWord _ _ _ _ _ rfl),
      Inv32Guards.clean _ _ _ _ _ hp (Inv32Guards.readWord _ _ _ _ _ rfl), ?_⟩
    let env := locals (Inv32FloorHoist.st2 inside flag 0 s p)
    have a := Inv32ProductValues.cleanup (localWord "otherPart") true env o ho rfl
    have b := Inv32ProductValues.cleanup (localWord "numeratorPart") true env p hp rfl
    exact evalFormula add c _ _ (by decide) (ch ▸ Inv32Midpoint.plusValue env _ _ o p ho hp fits a b)
  have F := Inv32FloorHoist.success n c inside flag _ _ _ s p (o+p) hs hp fits positive qr args (by decide) (by decide) (by decide) (by decide)
  let next := Inv32OneArg.store inside flag q
  have ret := Inv32CompareValues.retOne (n+14) t c next (castCopy flag).core q
    (evalFormula (castCopy flag) c next q (by decide) (castValue _ (locals next) flag q qr rfl))
  have Z := zero (n+14) t c inside flag
  exact Inv32FloorFastPath.blockReturned _ _ _ pre next _ _ ((seqStep _ _ _ _ _ _ _ Z).trans
    ((seqStep _ _ _ _ _ _ _ F).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ ret)))
theorem execute (n : Nat) (c : Context) (r : Runtime) (s p o : Nat) (hs : s<R) (hp : p<R) (ho : o<R) (pos : 0<o+p) (ch : c.checked=true) :
    let pre := root r s p o
    Stmt.eval (n+18) Inv32Dispatch.model.core.table c pre test = pure
      (if o+p<R then .returned pre [.word (Inv32RatioLoop.answer s p o)] else .normal pre) := by
  let t := Inv32Dispatch.model.core.table
  let pre := root r s p o
  let A := pre.pushScope.declareLocal operand0 (.word o)
  let B := A.declareLocal operand1 (.word (R-1))
  let C := B.declareLocal operand2 (.word p)
  let D := withOps pre p o
  have maxR : R-1<R := by decide
  have diffR : R-1-p<R := lt_of_le_of_lt (Nat.sub_le _ _) maxR
  have T0 := Inv32Temps.temp (n+16) t c pre.pushScope operand0 "otherPart" o ho rfl
  have maxVal : maxWord.run c.checked (locals A) = some (R-1) := Inv32ProductValues.cleanup (literal (R-1)) _ _ _ maxR (by rfl)
  have T1 := Inv32Hoist.declEval (n+16) t c A operand1 .uint256 maxWord.core (R-1)
    (evalFormula _ _ _ _ (by decide) maxVal) (by rw [Ty.coerceValue?])
  have T2 := Inv32Temps.temp (n+16) t c B operand2 "numeratorPart" p hp rfl
  have lhs := Inv32InverseSteps.capRead c C operand1 (R-1) maxR rfl
  have rhs := Inv32InverseSteps.capRead c C operand2 p hp rfl
  have T3 := Inv32Hoist.declEval (n+16) t c C operand3 .uint256 diff.core (R-1-p)
    (evalFormula diff c C _ (by decide) (subValue _ _ _ _ _ _ maxR hp (by omega) lhs rhs)) (by rw [Ty.coerceValue?])
  have cmp : le.run c.checked (locals D) = some (boolWord (decide (o+p<R))) := by
    have left := Inv32InverseSteps.capRead c D operand0 o ho rfl
    have right := Inv32InverseSteps.capRead c D operand3 (R-1-p) diffR rfl
    have relation : BinaryOp.apply c.checked .le (.word o) (.word (R-1-p)) = .ok (.word (if o≤R-1-p then 1 else 0)) :=
      Inv32WideGuards.leWord _ _ ho diffR
    simp [le,Inv32WideGuards.leF,binary,left,right,relation,projectWord,boolWord,show o≤R-1-p ↔ o+p<R by omega]
  let select := Stmt.ifElse le.core early .skip
  have branch := Inv32Blocks.branch (n+16) t c D le.core early .skip _ (evalFormula _ _ _ _ (by decide) cmp)
  have firstSteps : Stmt.evalList (n+17) t c pre.pushScope [temp operand0 "otherPart",.varDecl .uint256 operand1 (some maxWord.core),
      temp operand2 "numeratorPart",.varDecl .uint256 operand3 (some diff.core),select] = Stmt.evalList (n+17) t c D [select] :=
    (seqStep _ _ _ _ _ _ _ T0).trans ((seqStep _ _ _ _ _ _ _ T1).trans ((seqStep _ _ _ _ _ _ _ T2).trans (seqStep _ _ _ _ _ _ _ T3)))
  dsimp only
  by_cases bound : o+p<R
  · rw [if_pos bound]; simp only [bound,decide_true,if_true] at branch
    exact Inv32FloorFastPath.blockReturned _ _ _ pre D _ _ (firstSteps.trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _
      (branch.trans (earlyExec n c r s p o hs hp ho pos bound ch))))
  · rw [if_neg bound]; simp only [bound,decide_false,Bool.false_eq_true,if_false] at branch
    have skip : Stmt.eval (n+16) t c D .skip = pure (.normal D) := by rw [Stmt.eval]
    exact Inv32Hoist.block _ _ _ pre D _ (firstSteps.trans ((seqStep _ _ _ _ _ _ [] (branch.trans skip)).trans (by rw [Stmt.evalList])))
end Inv32RatioNarrow
