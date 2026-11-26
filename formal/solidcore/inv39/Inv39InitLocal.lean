import Inv39InitControl
open SolidCore.Solidity.Source
namespace Inv39.Init
theorem resolve (c : Context) (r : Runtime) (name : String) (valid : safeEnv r.locals) :
    Frame.Ensures ((LValue.var name).resolveWithRuntime c r) (fun q => q.2=r ∧ q.1=.local name) := by
  change Frame.Ensures (Expr.resolveLValueFuel ((Expr.var name).orderFuel+1) c r (.var name)) _
  simp only [Expr.resolveLValueFuel,noAlias _ _ valid]; split
  · exact Frame.pureValue (P:=fun q : ResolvedLValue × Runtime => q.2=r ∧ q.1=.local name) _ ⟨rfl,rfl⟩
  · exact Frame.failure _
theorem cleanLocal (base : State) (t : FunctionTable) (c : Context) (name : String) (bits : Nat) (e : Expr) (rhs : Frame.ReadOnly e) :
    Frame.StmtPreserves (region base) t c (.assign (.var name) (.castOp .uintCleanup bits e)) := by
  apply Frame.castSet _ _ _ _ _ _ _ Frame.isWord (fun _ loc => loc=.local name) (Frame.cleaned rhs bits)
  · exact fun r hr => resolve _ _ _ hr.2
  · rintro r loc v next hr hv rfl ok
    simp only [ResolvedLValue.write] at ok; split at ok
    · rename_i mid written; cases ok; exact localAssigned _ _ _ _ _ hr written
    · contradiction
theorem variableRef (c : Context) (r : Runtime) (x : String) :
    Frame.Ensures ((Expr.var x).memoryRefOrValue c r) (fun q => q.2.2=r) := by
  unfold Expr.memoryRefOrValue
  rw [Expr.memoryRefOrValueFuel]; split
  · exact Frame.pureValue _ rfl
  · apply Frame.bind (Frame.localRead x _ c r); rintro ⟨v,post⟩ same
    exact Frame.pureValue (P:=fun q : Option Nat × Option Value × Runtime => q.2.2=r) _ same
theorem valueRef (c : Context) (r : Runtime) (x : String) :
    Frame.Ensures ((Expr.var x).evalMemoryRefPreserving c r) (fun q => q.2=r) := by
  unfold Expr.evalMemoryRefPreserving; apply Frame.bind (variableRef c r x)
  rintro ⟨i,val,post⟩ eq; change post=r at eq; subst post
  cases i <;> cases val <;> first | exact Frame.pureValue _ rfl | exact Frame.localRead x _ c r
theorem copy (b : State) (t : FunctionTable) (c : Context) (dst src : String) :
    Frame.StmtPreserves (region b) t c (.assign (.var dst) (.var src)) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    have reads : Frame.Ensures (if (LValue.var dst).wantsMemoryRefRhs r then (Expr.var src).evalMemoryRefPreserving c r else
          (Expr.var src).eval c r) (fun q => q.2=r) := by split <;> first | exact valueRef _ _ _ | exact Frame.localRead _ _ _ _
    split
    · split
      · rename_i mid wrote; apply Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal mid); apply rawAssigned _ _ _ _ _ _ _ wrote <;> first | trivial | exact hr
      · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
    · apply Frame.bind (Frame.caught reads)
      rintro (err|⟨v,mid⟩) eq
      · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
      · change mid=r at eq; subst mid
        apply Frame.bind (Frame.caught (resolve c r dst hr.2)); rintro (err|⟨loc,post⟩) pred
        · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
        · change post=r ∧ loc=.local dst at pred; obtain ⟨rfl,rfl⟩ := pred
          simp only [noAlias post src hr.2,Option.isSome_none,Bool.false_eq_true,if_false,ResolvedLValue.write]
          split
          · rename_i mid wrote; split at wrote
            · rename_i out changeLoc; cases wrote; exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal _) (localAssigned _ _ _ _ _ hr changeLoc)
            · contradiction
          · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ hr
end Inv39.Init
