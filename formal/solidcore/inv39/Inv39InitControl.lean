import Inv39InitMemory
import Inv39InputReads
import Inv39EventEffect
open SolidCore.Solidity.Source
namespace Inv39.Init
theorem capture (b : State) (t : FunctionTable) (c : Context) (names : List String) (s : Stmt)
    (body : Frame.StmtPreserves (region b) t c s) : Frame.StmtPreserves (region b) t c (.captureReturn names s) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; apply Frame.bind (body n r hr)
    intro result good; cases result <;> first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ good | skip
    dsimp only
    split_ifs <;> first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ good | skip
    split
    · rename_i mid vals update wrote
      exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal _) (namedPlain _ _ _ _ _ good wrote)
    · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ good
theorem requireFrame (P : Runtime → Prop) (t : FunctionTable) (c : Context) (e : Expr) (reason : Option String) (valid : Frame.ReadOnly e) :
    Frame.StmtPreserves P t c (.requireStmt e reason) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; apply Frame.bind (Frame.caught (valid _ c r)); rintro (err|⟨v,mid⟩) eq
    · exact Frame.pureValue (P:=fun res : Result => P res.runtime) _ hr
    · change mid=r at eq; subst mid; dsimp only
      split <;> first | exact Frame.pureValue (P:=fun res : Result => P res.runtime) _ hr | skip
      split <;> first | exact Frame.pureValue (P:=fun res : Result => P res.runtime) _ hr | skip
      cases reason <;> exact Frame.pureValue (P:=fun res : Result => P res.runtime) _ hr
theorem emitFrame (b : State) (t : FunctionTable) (c : Context) (name : String) (es : List Expr) (valid : ∀ e∈es, Frame.ReadOnly e) :
    Frame.StmtPreserves (region b) t c (.emitEvent name es) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    have sched (ids : List Nat) : ∀ x∈ids.filterMap (fun i=>es[i]?), Frame.ReadOnly x := by
      intro x hx
      obtain ⟨i,_,get⟩ := List.mem_filterMap.mp hx
      exact valid x (List.mem_of_getElem? get)
    apply Frame.bind (Frame.caught (Frame.inputs _ (sched _) _ c r))
    rintro (err|⟨vs,mid⟩) eq
    · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
    · change mid=r at eq; subst mid; dsimp only
      split <;> first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr | skip
      split
      · rename_i out ok
        have same := logPreservesStorage _ _ _ _ _ ok
        apply Frame.pureValue (P:=fun res : Result => region b res.runtime)
        exact ⟨unchanged hr.1 same.1,by change safeEnv out.locals; rw [same.2]; exact hr.2⟩
      · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
end Inv39.Init
