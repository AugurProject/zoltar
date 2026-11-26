import Inv08Integral
open SolidCore.Solidity.Source
namespace Inv08.Integral
private theorem bindOk {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
private theorem liftOk {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α) = pure v := rfl

theorem memberReads (c : Context) (r : Runtime) (name : String) (index slot word : Nat) (layout : StorageLayout)
    (indexBound : index < Inv32Division.R)
    (aliasSlot : r.lookupStorageBase? name = some (.slot slot layout))
    (wordAt : r.loadStorageBasePath c (.slot slot layout) [.word index] = .ok (.word word)) :
    Inv40.Reads c r (member name index).value word := by
  intro fuel enough
  change 3 ≤ fuel at enough
  obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le enough
  have num : Expr.evalFuel (n+1) c r (.word index) = pure (.word index,r) := by rw [Expr.evalFuel, show normWord index = index from Nat.mod_eq_of_lt indexBound]
  have base : Expr.resolveLValueFuel (n+1) c r (.var name) = pure (.storageSlotPath slot layout [],r) := by
    simp [Expr.resolveLValueFuel,aliasSlot]
  have indexed : Expr.resolveLValueFuel (n+2) c r (.index (.var name) (.word index)) =
      pure (.storageSlotPath slot layout [.word index],r) := by
    rw [Expr.resolveLValueFuel,base]
    simp only [bindOk,num]
    rfl
  have read : (ResolvedLValue.storageSlotPath slot layout [.word index]).read c r = .ok (.word word) := by
    simp [ResolvedLValue.read,ResolvedLValue.readRaw,wordAt,Bind.bind,Except.bind,Runtime.derefMemoryValue]
  rw [Nat.add_comm]
  change Expr.evalFuel (n+3) c r (.index (.var name) (.word index)) = _
  rw [Expr.evalFuel]
  simp only [Expr.hasStorageRoot,Expr.hasStorageRefRoot,aliasSlot,Option.isSome_some,Bool.false_eq_true,
    if_false,if_true,indexed,bindOk,read,liftOk]
end Inv08.Integral
