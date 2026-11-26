import Inv39MarkerPrefixSyntax
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
set_option maxHeartbeats 4000000
namespace Inv39.Init.Marker.Prefix

theorem universeWriteLocals (c : Context) (r next : Runtime) (v : Source.Value)
    (fields : c.storageFields=model.core.context.storageFields)
    (write : (ResolvedLValue.storageField "universeId").write c r v=.ok next) :
    next.locals=r.locals := by
  have lookup : c.storageField? "universeId"=some (field .universe) := by
    change c.storageFields.find? _ = _; rw [fields]; exact layout .universe
  change r.storeStorageFieldWithDeepClear c "universeId" v=.ok next at write
  unfold Runtime.storeStorageFieldWithDeepClear at write
  rw [lookup] at write
  cases materialized : r.storageMaterializedValue v with
  | error err => simp [materialized,Bind.bind,Except.bind] at write
  | ok value =>
    simp only [materialized,Bind.bind,Except.bind,field,kind,scalar,if_true] at write
    unfold Runtime.storeStorageField at write
    rw [lookup] at write
    cases mat : r.storageMaterializedValue value with
    | error err => simp [mat,Bind.bind,Except.bind] at write
    | ok val =>
      simp only [mat,Bind.bind,Except.bind,field,kind,scalar,if_true] at write
      cases conv : coerceStorageWordAs .uint256 val with
      | error err => simp [conv] at write
      | ok word => simp only [conv] at write; cases write; rfl

theorem universeLocals (c : Context) (fields : c.storageFields=model.core.context.storageFields)
    (base : LocalEnv) : Frame.StmtPreserves (fun r => r.locals=base) model.core.table c universeStore := by
  apply Frame.castSet _ _ _ _ _ _ _ Frame.isWord (fun _ loc => loc=.storageField "universeId")
    (Frame.cleaned (Frame.localRead _) 248)
  · intro r hr
    exact Frame.pureValue _ ⟨rfl,rfl⟩
  · rintro r loc v next hr hv rfl write
    exact (universeWriteLocals c r next v fields write).trans hr

end Inv39.Init.Marker.Prefix

namespace Inv39.Init.Marker.Prefix
theorem universeShape (n : Nat) (c : Context) (r : Runtime)
    (fields : c.storageFields=model.core.context.storageFields) :
    Fold.Ensures (Source.Stmt.eval (n+1) model.core.table c r universeStore)
      (Auth.normal (fun q => q.locals=r.locals)) := by
  unfold universeStore
  rw [Source.Stmt.eval]
  dsimp only [LValue.wantsMemoryRefRhs]
  apply Fold.bind (Q:=Auth.normal (fun q => q.locals=r.locals))
    (Fold.fromFrame (Frame.caught (Frame.cleaned (Frame.localRead "universeId_") 248 _ c r)))
  rintro (err|⟨v,mid⟩) h
  · exact Fold.pureValue (Result.reverted r _) _ trivial
  · change mid=r ∧ Frame.isWord v at h
    obtain ⟨eq,hv⟩ := h
    subst mid
    have resolved : (LValue.storage "universeId").resolveWithRuntime c r=pure (.storageField "universeId",r) := rfl
    simp only [resolved]
    change Fold.Ensures (match (ResolvedLValue.storageField "universeId").write c r v with
      | .ok next => pure (Result.normal next) | .error err => pure (Result.reverted r err)) _
    split
    · rename_i next write
      exact Fold.pureValue (Result.normal next) _ (universeWriteLocals c r next v fields write)
    · exact Fold.pureValue (Result.reverted r _) _ trivial
end Inv39.Init.Marker.Prefix
