import Inv39InitDeclarations
import Inv39DecimalCall
open SolidCore.Solidity.Source
namespace Inv39.Init
theorem safePlain (l : LocalEnv) (h : Frame.plainEnv l) : safeEnv l := by
  intro f hf p hp; have ok := h f hf p hp
  cases eq:p.2 <;> simp only [eq] at ok <;> first | trivial | contradiction
theorem targetsRegion (b : State) (r : Runtime) (names : List String) (vs : List Value) (h : region b r) :
    Frame.Ensures (internalCallAssign r names vs) (fun res=>region b res.runtime) := by
  unfold internalCallAssign; split <;> first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ h | skip
  split
  · rename_i mid ok; exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal mid) (namedRef _ _ _ _ _ h ok)
  · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ h
theorem finishRegion (b : State) (f : InternalFunction) (targets : List String) (caller : LocalEnv) (result : Result)
    (h : region b result.runtime) (saved : safeEnv caller) : Frame.Ensures (internalCallFinish f targets caller result) (fun res=>region b res.runtime) := by
  cases result <;> simp only [internalCallFinish]
  all_goals first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ h | skip
  all_goals split <;> first
    | exact targetsRegion _ _ _ _ ⟨h.1,saved⟩
    | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ h
theorem decimalCall (base : State) (n : Nat) (c : Context) (r : Runtime) (arg : String) (v : Nat) (targets : List String)
    (read : r.lookupLocal? arg=some (.word v)) (ready : region base r) :
    Frame.Ensures (Stmt.eval (n+1) model.core.table c r (.internalCall targets Decimal.key [.var arg]))
      (fun out => region base out.runtime) := by
  obtain ⟨f,found,ps,rs,safe⟩ := Decimal.linked
  let inner := {r with locals:=[[("absoluteValue",.word v),("_ret0",.bytes [])]]}
  have args : Expr.evalRefArgList c r [.var arg]=pure ([.word v],r) := by
    change (do let (a,s) ← Expr.evalRefArg c r (.var arg); let (vs,s') ← Expr.evalRefArgListFuel _ c s []; pure (a::vs,s'))=_
    rw [Inv32ProductCall.wordArg _ _ _ _ read]; rfl
  have enter : internalCallEnter? f [.word v] r=some (inner,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?,BindingDecl.defaultBinding,Ty.defaultValue,inner]
  have initial : Frame.plainEnv inner.locals := by
    simp [inner,Frame.plainEnv,Frame.plainFrame,Frame.plain]
    rintro a b (⟨rfl,rfl⟩|⟨rfl,rfl⟩) <;> trivial
  rw [Stmt.eval]; dsimp only; rw [args]
  change Frame.Ensures (match model.core.table.lookup? Decimal.key with
      | none => pure (Result.reverted r RevertData.typeMismatch)
      | some g => match internalCallEnter? g [.word v] r with
        | none => pure (Result.reverted r RevertData.typeMismatch)
        | some (start,saved) => Stmt.eval n model.core.table {c with checked:=true} start g.body >>= internalCallFinish g targets saved) _
  simp only [found,enter]
  apply Frame.bind (Frame.stmtsSound r.state model.core.table {c with checked:=true} f.body safe n inner ⟨rfl,initial⟩)
  intro result framed
  exact finishRegion _ _ _ _ _ ⟨unchanged ready.1 framed.1,safePlain _ framed.2⟩ ready.2
end Inv39.Init
