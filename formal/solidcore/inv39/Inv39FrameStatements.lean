import Inv39FrameAssign
open SolidCore.Solidity.Source
namespace Inv39.Frame
theorem expr (b : State) (t : FunctionTable) (c : Context) (e : Expr)
    (ok : ∀ r, region b r → Ensures (e.eval c r) (fun q => region b q.2)) : StmtPreserves (region b) t c (.exprStmt e) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n =>
    rw [Stmt.eval]; apply bind (caught (ok r hr))
    rintro (err|⟨v,post⟩) good <;> first
      | exact pureValue (P:=fun out : Result => region b out.runtime) _ hr
      | exact pureValue (P:=fun out : Result => region b out.runtime) _ good
theorem declNone (b : State) (t : FunctionTable) (c : Context) (name : String) :
    StmtPreserves (region b) t c (.varDecl .uint256 name none) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n => simp only [Stmt.eval,Ty.defaultValue]; exact pureValue (P:=fun out : Result => region b out.runtime) _ (declared _ _ name (.word 0) trivial hr)
theorem declWord (b : State) (t : FunctionTable) (c : Context) (name : String) (e : Expr) (typed : TypedRead e isWord) :
    StmtPreserves (region b) t c (.varDecl .uint256 name (some e)) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n =>
    rw [Stmt.eval]; apply bind (caught (typed _ c r))
    rintro (err|⟨v,mid⟩) ok
    · exact pureValue (P:=fun out : Result => region b out.runtime) _ hr
    · change mid=r ∧ isWord v at ok
      obtain ⟨rfl,w,rfl⟩ := ok
      exact pureValue (P:=fun out : Result => region b out.runtime) _ (declared _ _ _ (.word w) trivial hr)
theorem localize (b : State) (t : FunctionTable) (c : Context) (ty : Ty) (name : String) :
    StmtPreserves (region b) t c (.memoryLocalize ty name) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n =>
    rw [Stmt.eval]
    dsimp only
    cases ok:r.localizeMemoryLocal ty name with
    | none => exact pureValue (P:=fun out : Result => region b out.runtime) (.reverted r _) hr
    | some next => exact pureValue (P:=fun out : Result => region b out.runtime) (.normal next) (memoryLocalize _ _ _ name ty hr ok)
def memoryResult (r : Runtime) : Option Nat × Option Value × Runtime → Prop | (none,some _,s) => s=r | _ => False
theorem buffer (b : State) (t : FunctionTable) (c : Context) (ty : Ty) (name : String) (e : Expr) (size : ReadOnly e) :
    StmtPreserves (region b) t c (.memoryVarDecl ty name (some (.newBytes e))) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n =>
    have w : Ensures ((Expr.newBytes e).memoryRefOrValue c r) (memoryResult r) := by
      unfold Expr.memoryRefOrValue
      rw [Expr.memoryRefOrValueFuel]; apply bind (newBytes e size _ c r)
      rintro ⟨v,mid⟩ eq
      exact pureValue (P:=memoryResult r) _ eq
      all_goals simp
    rw [Stmt.eval]; apply bind (caught w)
    rintro (err|⟨id,v,mid⟩) good
    · exact pureValue (P:=fun out : Result => region b out.runtime) _ hr
    · cases id <;> cases v <;> first | contradiction | skip
      rename_i val; change mid=r at good; subst mid
      dsimp only
      cases eq:r.declareMemoryLocal ty name val <;> first
        | exact pureValue (P:=fun out : Result => region b out.runtime) _ hr
        | exact pureValue (P:=fun out : Result => region b out.runtime) _ (memoryDecl _ _ _ _ _ _ hr eq)
theorem returned (b : State) (t : FunctionTable) (c : Context) (e : Expr)
    (read : ∀ r, Ensures (e.evalReturnValue c r) (fun q => q.2=r)) : StmtPreserves (region b) t c (.returnValues [e]) := by
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n =>
    have ev : Ensures (Expr.evalReturnList c r [e]) (fun q => q.2=r) := by
      unfold Expr.evalReturnList
      change Ensures (Expr.evalReturnListFuel (_+1+1) c r [e]) _
      rw [Expr.evalReturnListFuel]; apply bind (read r)
      rintro ⟨v,post⟩ eq
      exact pureValue (P:=fun q : List Value × Runtime => q.2=r) _ eq
    rw [Stmt.eval]; apply bind (caught ev)
    rintro (err|⟨vs,post⟩) same
    · exact pureValue (P:=fun out : Result => region b out.runtime) _ hr
    · change post=r at same; subst post; exact pureValue (P:=fun out : Result => region b out.runtime) _ hr
end Inv39.Frame
