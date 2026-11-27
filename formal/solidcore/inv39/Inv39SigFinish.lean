import Inv39SigEnter
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem noRefAssign (r : Runtime) (k : String) (v : Value) (safe : safeEnv r.locals)
    (non : ¬aliases k) : r.assignStorageRefValue? k v=none := by
  unfold Runtime.assignStorageRefValue?; cases eq:r.lookupLocal? k with
  | none=>rfl
  | some old=>have hv := (safeLookup safe eq).resolve_left non; cases old <;> first | rfl | contradiction

theorem refWrites {c : Context} {w : Watch} (r q : Runtime) (ks : List String) (vs : List Value) (safe : safeEnv r.locals)
    (hide : ks.all (writable w)) (ok : r.assignNamedValuesRef? ks vs=some q) : Relative w c r q := by
  induction ks generalizing r vs with
  | nil=>cases vs <;> first | cases ok; exact Relative.refl _ _ _ safe | contradiction
  | cons k ks ih=>
    cases vs with
    | nil=>contradiction
    | cons v vs=>
      simp only [List.all_cons,Bool.and_eq_true] at hide
      rw [Runtime.assignNamedValuesRef?] at ok; split at ok
      · rename_i mid written
        have step : Relative w c r mid := by
          unfold Runtime.assignLocalRefAware? at written
          split at written <;> first | exact localWrite safe (mayWrite hide.1).1 written | rw [noRefAssign _ _ _ safe (mayWrite hide.1).2] at written; contradiction
        exact step.trans (ih mid vs step.safe hide.2 ok)
      · contradiction

theorem assignedResult {allow w c r} (mid : Runtime) (ks : List String) (vs : List Value) (safe : Relative w c r mid)
    (hide : ks.all (writable w)) : Fold.Ensures (internalCallAssign mid ks vs) (post allow w c r) := by
  unfold internalCallAssign; split
  · exact Fold.pureValue (Result.normal mid) _ safe
  · split
    · rename_i q ok; exact Fold.pureValue (Result.normal q) _ (safe.trans (refWrites mid q ks vs safe.safe hide ok))
    · exact Fold.pureValue (Result.reverted mid _) _ trivial

theorem finish {allow w c} (r : Runtime) (f : InternalFunction) (ks : List String)
    (hide : ks.all (writable w)) (safe : safeEnv r.locals) (result : Result)
    (effect : match result with | .normal q | .returned q _=>Fold.echo c r.state q.state | .reverted _ _=>True | _=>False) :
    Fold.Ensures (internalCallFinish f ks r.locals result) (post allow w c r) := by
  have completed (q : Runtime) (reply : Except RevertData (List Value)) (echo : Fold.echo c r.state q.state) :
      Fold.Ensures (match reply with
        | .ok vals=>internalCallAssign {q with locals:=r.locals} ks vals
        | .error err=>pure (Result.reverted q err)) (post allow w c r) := by
    cases reply with
    | error err=>exact Fold.pureValue (Result.reverted q err) _ trivial
    | ok vs=>exact assignedResult _ _ _ (sameLocals (r:=r) (q:={q with locals:=r.locals}) echo rfl safe) hide
  cases result with
  | normal q=>exact completed q (collectReturnBindingsRef f.returns q) effect
  | returned q vs=>exact completed q (if vs.isEmpty then collectReturnBindingsRef f.returns q else coerceReturnBindingsRef f.returns q vs) effect
  | reverted q e => exact Fold.pureValue (Result.reverted q e) _ trivial
  | _ => contradiction
end Inv39.Auth
