import Inv08AddStreamExpiry
import Inv12LedgerShape
import Inv12QuotaReadback
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv12

def credit (r : Runtime) (a : Ref) (off delta : Nat) : Runtime :=
  {r with state:=putAmount r.state a.slot off (a.get r.state off+delta)}

theorem creditLocal (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (branch : Ref) (i off : Nat) (localName : String) (v : Nat) (b : branch.bound r "branch")
    (small : i<R) (field : branch.hasField i off) (lookup : r.lookupLocal? localName=some (.word v))
    (fits : branch.get r.state off+v<R) :
    Stmt.eval (n+1) t c r (.exprStmt (addMember "branch" i (.var localName)))=pure (.normal (credit r branch off v)) := by
  have ev := increment 3 c r branch "branch" i off v (.var localName) b small field
    (Inv32Guards.readWord _ _ _ _ _ lookup) fits
  have E : (addMember "branch" i (.var localName)).eval c r=pure (.word (branch.get r.state off+v),credit r branch off v) := ev
  rw [Stmt.eval]; dsimp only; rw [E]; rfl

def totalGuard := Stmt.requireStmt (.binary .ne (member "fork" 1).value (.word 0)) (some "Fork commitment missing")

theorem funded (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (f : Ref)
    (bound : f.bound r "fork") (field : f.hasField 1 1) (positive : 0<f.get r.state 1) :
    Stmt.eval (n+1) t c r totalGuard = pure (.normal r) := by
  have left := f.cleanRead c r "fork" 1 1 (by decide) bound field
  have right := Inv08.Authority.literal c r 0 (by decide)
  have value := Inv08.ReleaseQuote.binary left right .ne (by intro h;cases h) (by intro h;cases h)
    (Inv08.AddStream.neRead c _ 0 (f.fits _ _) (by decide))
  simp only [if_neg (Nat.ne_of_gt positive)] at value
  exact Inv32QuoteGuard.requireEval n t c r _ true _ (value _ (Nat.le_succ _))
end Inv12
