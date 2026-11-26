import Inv05HarnessHoist
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath Inv32QuoteExpr Inv32Actions Inv03.Bodies
namespace Inv05.Harness

theorem resultSmall (cash units net a : Nat) (got : result cash units net = some a) :
    a=amount cash units net ∧ a<R := by
  by_cases h : cash=0
  · subst cash
    change some 0 = some a at got
    cases got
    simp [amount,R]
  · simp only [result,if_neg h,quote] at got
    split at got
    · rename_i cond
      cases got
      exact ⟨rfl,cond.1⟩
    · contradiction

def Outcome (r : Runtime) (o : Option Nat) (p : SolI Result) : Prop :=
  match o with
  | some a => p = pure (.returned r [.word a])
  | none => ∃ nr e, p = pure (.reverted nr e)

theorem execute (f : Nat) (c : Context) (r : Runtime) (cash units net : Nat)
    (hc : cash<R) (hu : units<R) (hn : net<R) (funded : units=0 ∨ 0<net) (fits : cash*10^9<R) :
    let src := r.withFrame (frame cash units net)
    Outcome src (allUnits cash units net) (Stmt.eval (f+32) Inv03.model.core.table c src shape.value) := by
  let t := Inv03.model.core.table
  let src := r.withFrame (frame cash units net)
  let outer := src.pushScope
  let work := inner r cash units net
  have A := cleanParamExec (f+30) t c outer "deposit" cash hc rfl (by dsimp [outer,src,frame]; write_param)
  have B := cleanParamExec (f+30) t c outer "units" units hu rfl (by dsimp [outer,src,frame]; write_param)
  have C := cleanParamExec (f+30) t c outer "netCash" net hn rfl (by dsimp [outer,src,frame]; write_param)
  have S : Stmt.eval (f+31) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have zeroed := zero (f+29) t c work tmp
  have run := hoisted f c r cash units net hc hu hn funded fits
  dsimp only
  cases Q : allUnits cash units net with
  | none =>
    rw [Q] at run
    obtain ⟨nr,e,ev⟩ := run
    have mid := Inv32Revert.blockRevert (f+30) t c outer nr
      [.varDecl .uint256 tmp none,setup.value,.returnValues [(castCopy tmp).core]] e
      ((seqStep _ _ _ _ _ _ _ zeroed).trans (Inv32Revert.stop _ _ _ _ _ _ _ _ ev))
    exact ⟨_,e,Inv32Revert.blockRevert _ _ _ _ _ _ _ ((seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans
      ((seqStep _ _ _ _ _ _ _ C).trans ((seqStep _ _ _ _ _ _ _ S).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ mid)))))⟩
  | some a =>
    rw [Q] at run
    let final := Inv32OneArg.store work tmp a
    have ret := Inv32CompareValues.retOne (f+29) t c final (castCopy tmp).core a
      (evalFormula _ c final a (by decide) (castValue _ _ _ _ (by
        by_cases h : units=0
        · simp [allUnits,h] at Q; simpa [←Q] using fits
        · exact (resultSmall _ _ _ _ (by simpa [allUnits,h] using Q)).2) rfl))
    have mid := blockReturned (f+30) t c outer final _ _ ((seqStep _ _ _ _ _ _ _ zeroed).trans
      ((seqStep _ _ _ _ _ _ _ run).trans (stop _ _ _ _ _ _ [] _ ret)))
    exact blockReturned _ _ _ _ outer _ _ ((seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans
      ((seqStep _ _ _ _ _ _ _ C).trans ((seqStep _ _ _ _ _ _ _ S).trans (stop _ _ _ _ _ _ [] _ mid)))))
end Inv05.Harness
