import Inv39SigFinish
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem guardCall (allow : Bool) (w innerWatch : Watch) (t : FunctionTable) (c : Context) (targets : List String)
    (key : String) (args : List Expr) (f : InternalFunction) (lookup : t.lookup? key=some f)
    (params : f.params.all fun d=>scalar d.ty) (rets : ∀ d∈f.returns,permitted d.defaultBinding)
    (callee : guards true innerWatch t {c with checked:=true} f.body)
    (hide : targets.all (writable w)) (vars : args.all ordinaryVar) :
    guards allow w t c (.internalCall targets key args) := by
  intro n r safe activeFrame; cases n with
  | zero=>rw [Stmt.eval]; exact Fold.reject _ _
  | succ n=>
    rw [Stmt.eval]
    apply Fold.bind (Q:=post allow w c r) (Fold.fromFrame (Frame.caught (refArguments _ c r args safe vars)))
    rintro (err|⟨vs,mid⟩) ok
    · exact Fold.pureValue (Result.reverted r _) _ trivial
    · dsimp only; rw [lookup]; change mid=r ∧ _ at ok; obtain ⟨rfl,sv⟩ := ok; dsimp only
      cases eq:internalCallEnter? f vs mid with
      | none=>exact Fold.pureValue (Result.reverted mid _) _ trivial
      | some pair=>
        rcases pair with ⟨start,saved⟩
        obtain ⟨innerSafe,active,st,rfl⟩ := enters _ _ _ _ _ params rets sv eq
        apply Fold.bind (Q:=post allow w c mid) (callee n start innerSafe active)
        intro result rel; apply finish mid f targets hide safe result
        cases result with
        | normal q => simpa only [←st] using rel.world
        | returned q vals=>simpa only [←st] using rel.2.world
        | reverted q e=>trivial
        | _ => contradiction

theorem captureNormal (allow : Bool) (w : Watch) (t : FunctionTable) (c : Context) (ss : Stmt) (names : List String)
    (guard : guards false w t c ss) : guards allow w t c (.captureReturn names ss) := by
  intro n r safe activeFrame; cases n with
  | zero=>rw [Stmt.eval]; exact Fold.reject _ _
  | succ n=>
    rw [Stmt.eval]; apply Fold.bind (Q:=post allow w c r) (guard n r safe activeFrame)
    intro res h; cases res with
    | normal q=>exact Fold.pureValue (Result.normal q) _ h
    | reverted q e=>exact Fold.pureValue (Result.reverted q e) _ trivial
    | returned q vs=>have bad := h.1; contradiction
    | _=>contradiction
end Inv39.Auth
