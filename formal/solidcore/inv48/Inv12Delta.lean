import Inv12Increment
import Inv12Inputs
open SolidCore.Solidity.Source Inv32Division
namespace Inv12

def addMember (name : String) (i : Nat) (rhs : Expr) :=
  Expr.assignment (some .add) (some (.uint 256)) (.index (.var name) (.word i)) rhs

private def cleanWord := Expr.castOp .uintCleanup 256
def deltaExpr := cleanWord (cleanWord (.binary .sub (member "branch" 6).value (cleanWord (.var "previousCash"))))

theorem deltaRead (c : Context) (r : Runtime) (b : Ref) (old : Nat) (bound : b.bound r "branch")
    (field : b.hasField 6 5) (prev : r.lookupLocal? "previousCash"=some (.word old))
    (ordered : old≤b.get r.state 5) : Inv40.Reads c r deltaExpr (b.get r.state 5-old) := by
  have fit := b.fits r.state 5
  have oldfit := lt_of_le_of_lt ordered fit
  have df := lt_of_le_of_lt (Nat.sub_le (b.get r.state 5) old) fit
  have diff := Inv08.ReleaseQuote.binary (b.cleanRead c r _ _ _ (by decide) bound field)
    (Inv08.ReleaseQuote.readClean (Inv08.localReads c r _ _ prev) oldfit)
    .sub (by intro h; cases h) (by intro h; cases h) (Inv32QuoteExpr.subWord c.checked _ _ fit oldfit ordered)
  exact Inv08.ReleaseQuote.readClean (Inv08.ReleaseQuote.readClean diff df) df

theorem recordsDelta (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (f b : Ref)
    (old : Nat) (fork : f.bound r "fork") (branch : b.bound r "branch") (field : b.hasField 6 5)
    (assigned : f.hasField 5 5) (prev : r.lookupLocal? "previousCash"=some (.word old))
    (ordered : old≤b.get r.state 5) (fit : f.get r.state 5+(b.get r.state 5-old)<R) :
    Stmt.eval (n+1) t c r (.exprStmt (addMember "fork" 5 deltaExpr))=
      pure (.normal {r with state:=putAmount r.state f.slot 5 (f.get r.state 5+(b.get r.state 5-old))}) := by
  have read := deltaRead c r b old branch field prev ordered
  let k := (addMember "fork" 5 deltaExpr).orderFuel-2
  have eqn : (addMember "fork" 5 deltaExpr).orderFuel+1=k+3 := by decide +revert
  have enough : deltaExpr.orderFuel≤k+2 := by decide +revert
  have ev := increment k c r f "fork" 5 5 _ deltaExpr fork (by decide) assigned (read _ enough) fit
  have E : (addMember "fork" 5 deltaExpr).eval c r=pure (.word (f.get r.state 5+(b.get r.state 5-old)),{r with state:=putAmount r.state f.slot 5 (f.get r.state 5+(b.get r.state 5-old))}) := by
    unfold Expr.eval; rw [eqn]; exact ev
  rw [Stmt.eval]; dsimp only; rw [E]; rfl
end Inv12
