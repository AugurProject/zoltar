import Inv39Debit
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39
theorem debitAssignment (c : Context) (r : Runtime) (t : FunctionTable) (fuel addr old a : Nat)
    (src : r.lookupLocal? "from"=some (.word addr)) (bal : r.lookupLocal? "fromBalance"=some (.word old))
    (qty : r.lookupLocal? "value"=some (.word a)) (enough : a≤old) (fits : old<R)
    (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (fuel+1) t c r (.assign (.storageIndex "_balances" (.var "from")) difference) =
      pure (.normal {r with state:=r.state.storeSlot (balanceSlot addr) (old-a)}) := by
  have resolved : (LValue.storageIndex "_balances" (.var "from")).resolveWithRuntime c r =
      pure (.storageIndex "_balances" (.word addr),r) := resolveMapping _ _ _ _ 3 src
  have store : (ResolvedLValue.storageIndex "_balances" (.word addr)).write c r (.word (old-a)) =
      .ok {r with state:=r.state.storeSlot (balanceSlot addr) (old-a)} :=
    writeBalance _ _ _ _ (lt_of_le_of_lt (Nat.sub_le old a) fits) fields
  have ok {α : Type} (v : α) : (pure v : SolI α).caught = pure (.ok v) := rfl
  have bound {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
  rw [Stmt.eval]
  dsimp only
  simp only [LValue.wantsMemoryRefRhs, Bool.false_eq_true, if_false,
    differenceValue _ _ _ _ bal qty enough fits, ok,bound,resolved]
  change (match (ResolvedLValue.storageIndex "_balances" (.word addr)).write c r (.word (old-a)) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err)) = _
  rw [store]
end Inv39
