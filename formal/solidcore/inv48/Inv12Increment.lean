import Inv12Ref
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv12
theorem resolveMember (k : Nat) (c : Context) (r : Runtime) (a : Ref) (name : String) (i : Nat)
    (bound : a.bound r name) (small : i<R) :
    Expr.resolveLValueFuel (k+2) c r (.index (.var name) (.word i)) =
      pure (.storageSlotPath a.slot (.struct a.members) [.word i],r) := by
  have base : Expr.resolveLValueFuel (k+1) c r (.var name)=pure (.storageSlotPath a.slot (.struct a.members) [],r) := by
    simp [Expr.resolveLValueFuel,Ref.bound] at bound ⊢
    rw [bound]
  have ix : Expr.evalFuel (k+1) c r (.word i)=pure (.word i,r) := by
    rw [Expr.evalFuel,show normWord i=i from Nat.mod_eq_of_lt small]
  rw [Expr.resolveLValueFuel,base]
  simp only [Inv08.Authority.bindPure,ix]
  rfl

private theorem liftOk {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α) = pure v := rfl

theorem increment (k : Nat) (c : Context) (r : Runtime) (a : Ref) (name : String) (i off delta : Nat)
    (rhs : Source.Expr) (bound : a.bound r name) (small : i<R) (field : a.hasField i off)
    (evaluated : rhs.evalFuel (k+2) c r=pure (.word delta,r)) (fits : a.get r.state off+delta<R) :
    (Expr.assignment (some .add) (some (.uint 256)) (.index (.var name) (.word i)) rhs).evalFuel (k+3) c r =
      pure (.word (a.get r.state off+delta),{r with state:=putAmount r.state a.slot off (a.get r.state off+delta)}) := by
  let loc := ResolvedLValue.storageSlotPath a.slot (.struct a.members) [.word i]
  have read : loc.read c r=.ok (.word (a.get r.state off)) := by
    simp [loc,ResolvedLValue.read,ResolvedLValue.readRaw,amountField c r _ _ _ _ field,Ref.get,
      Bind.bind,Except.bind,Runtime.derefMemoryValue]
  have write : loc.write c r (.word (a.get r.state off+delta)) =
      .ok {r with state:=putAmount r.state a.slot off (a.get r.state off+delta)} :=
    writeAmount _ _ _ _ _ _ _ field
  have cleanup := Inv32Guards.cleanupWord c.checked _ fits
  rw [Expr.evalFuel,evaluated]
  simp only [Inv08.Authority.bindPure,resolveMember k c r a name i bound small]
  dsimp only [loc] at read write
  simp only [read,liftOk,Inv08.Authority.bindPure,Inv40.addWords _ _ _ fits,ValueCleanup.apply,cleanup,write]
end Inv12
