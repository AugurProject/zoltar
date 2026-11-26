import Inv39MarkerExecution
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
set_option maxHeartbeats 4000000
namespace Inv39.Init.Marker.Prefix

theorem requireShape (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (e : Source.Expr) (reason : Option String) (read : Frame.ReadOnly e) :
    Fold.Ensures (Source.Stmt.eval (n+1) t c r (.requireStmt e reason)) (Auth.normal (fun q => q=r)) := by
  rw [Source.Stmt.eval]
  apply Fold.bind (Q:=Auth.normal (fun q => q=r)) (Fold.fromFrame (Frame.caught (read _ c r)))
  rintro (err|⟨v,mid⟩) eq
  · exact Fold.pureValue (Result.reverted r _) _ trivial
  · change mid=r at eq
    subst mid
    dsimp only
    split <;> first | exact Fold.pureValue (Result.reverted r _) _ trivial | skip
    split <;> first | exact Fold.pureValue (Result.normal r) _ rfl | skip
    cases reason <;> exact Fold.pureValue (Result.reverted r _) _ trivial

theorem requireHead (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (e : Source.Expr) (reason : Option String) (tail : List Source.Stmt) (out : Result)
    (read : Frame.ReadOnly e)
    (run : (Source.Stmt.evalList (n+1) t c r (.requireStmt e reason::tail)).runWith []=.ok out)
    (nonrev : ∀ q err, out≠.reverted q err) :
    (Source.Stmt.eval (n+1) t c r (.requireStmt e reason)).runWith []=.ok (.normal r) ∧
    (Source.Stmt.evalList (n+1) t c r tail).runWith []=.ok out := by
  obtain ⟨head,first,rest⟩ := listExecution _ _ _ _ _ _ _ run
  have shape := requireShape n t c r e reason read
  unfold Fold.Ensures at shape
  have h := shape head first
  cases head with
  | normal mid => change mid=r at h; subst mid; exact ⟨first,rest⟩
  | reverted q err => exact False.elim (nonrev q err rest)
  | _ => contradiction

end Inv39.Init.Marker.Prefix
