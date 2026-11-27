import Inv12ChosenQuota
import Mathlib.Data.Nat.ModEq
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv12

theorem Ref.distinctOffsets (a : Ref) (i j : Nat) (fi : i<R) (fj : j<R) (ne : i≠j) :
    a.addressOf i≠a.addressOf j := by
  intro same
  change (((a.slot%R+i)%R)%R)=(((a.slot%R+j)%R)%R) at same
  simp only [Nat.mod_mod] at same
  have diff := Nat.ModEq.add_left_cancel' (a.slot%R) (show a.slot%R+i ≡ a.slot%R+j [MOD R] from same)
  exact ne (by simpa only [Nat.ModEq,Nat.mod_eq_of_lt fi,Nat.mod_eq_of_lt fj] using diff)

def saveCash (r : Runtime) (b : Ref) := r.declareLocal "previousCash" (.word (b.get r.state 5))
def snapshotStmt := Stmt.varDecl .uint256 "previousCash" (some (member "branch" 6).value)

theorem saveCashRun (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (b : Ref)
    (branch : b.bound r "branch") (amount : b.hasField 6 5) :
    Stmt.eval (n+1) t c r snapshotStmt=pure (.normal (saveCash r b)) :=
  Inv32Hoist.declEval n t c r _ _ _ _ (b.cleanRead c r _ 6 5 (by decide) branch amount _ (Nat.le_succ _)) rfl

theorem savedCash (r : Runtime) (b : Ref) :
    (saveCash r b).lookupLocal? "previousCash"=some (.word (b.get r.state 5)) := by
  cases h : r.locals <;> simp [saveCash,Runtime.lookupLocal?,Runtime.declareLocal,h,
    LocalEnv.lookup?,LocalEnv.declare,Frame.lookup?]
end Inv12
