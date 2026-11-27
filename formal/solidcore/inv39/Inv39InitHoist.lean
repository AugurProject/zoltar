import Inv39InitDecimal
open SolidCore.Solidity.Source
namespace Inv39.Init
abbrev arg := "_ic_arg_0"
abbrev ret := "_ret___library_DecimalStrings_toString_0"
abbrev temp := "_sol_hoist_0"
def fetch (e : Expr) := Stmt.block [
  .varDecl .uint256 arg (some e),
  .memoryVarDecl .bytesCalldata ret none,
  .captureReturn [ret] (.internalCall [ret] Decimal.key [.var arg]),
  .assign (.var temp) (.var ret)]
theorem captures (b : State) (t : FunctionTable) (c : Context) (r : Runtime) (names : List String) (s : Stmt)
    (n : Nat) (body : Frame.Ensures (Stmt.eval n t c r s) (fun out=>region b out.runtime)) :
    Frame.Ensures (Stmt.eval (n+1) t c r (.captureReturn names s)) (fun out=>region b out.runtime) := by
  rw [Stmt.eval]; apply Frame.bind body
  intro result good; cases result <;> first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ good | skip
  dsimp only; split_ifs <;> first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ good | skip
  split
  · rename_i mid vals update wrote
    exact Frame.pureValue (P:=fun res : Result => region b res.runtime) (.normal _) (namedPlain _ _ _ _ _ good wrote)
  · exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ good
theorem capDecimal (b : State) (c : Context) (r : Runtime) (n v : Nat) (known : r.lookupLocal? arg=some (.word v)) (hr : region b r) :
    Frame.Ensures (Stmt.eval n model.core.table c r (.captureReturn [ret] (.internalCall [ret] Decimal.key [.var arg]))) (fun out=>region b out.runtime) := by
  cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    apply captures
    cases n with
    | zero => rw [Stmt.eval]; exact Frame.failure _
    | succ n => exact decimalCall _ _ _ _ _ _ _ known hr
theorem cons (P : Runtime → Prop) (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (s : Stmt) (ss : List Stmt)
    (head : Frame.Ensures (Stmt.eval n t c r s) (fun res=>P res.runtime))
    (tail : ∀ mid, P mid → Frame.Ensures (Stmt.evalList n t c mid ss) (fun res=>P res.runtime)) :
    Frame.Ensures (Stmt.evalList n t c r (s::ss)) (fun res=>P res.runtime) := by
  rw [Stmt.evalList]; apply Frame.bind head
  intro res hr; cases res <;> first | exact tail _ hr | exact Frame.pureValue (P:=fun res : Result => P res.runtime) _ hr
theorem hoist (b : State) (c : Context) (e : Expr) (typed : Frame.TypedRead e Frame.isWord) :
    Frame.StmtPreserves (region b) model.core.table c (fetch e) := by
  let t := model.core.table
  intro n r hr; cases n with
  | zero => rw [Stmt.eval]; exact Frame.failure _
  | succ n =>
    rw [show fetch e=Stmt.block _ from rfl,Stmt.eval]
    apply Frame.bind (P:=fun out : Result => region b out.runtime)
    · rw [Stmt.evalList]
      cases n with
      | zero => rw [Stmt.eval]; exact Frame.failure _
      | succ n =>
        have decl : Frame.Ensures (Stmt.eval (n+1) t c r.pushScope (.varDecl .uint256 arg (some e))) (fun out =>
            match out with | .normal post => ∃ v, post=r.pushScope.declareLocal arg (.word v) | _ => region b out.runtime) := by
          rw [Stmt.eval]; apply Frame.bind (Frame.caught (typed _ c r.pushScope))
          rintro (err|⟨v,mid⟩) hv
          · exact Frame.pureValue (P:=fun out : Result=>match out with | .normal post => ∃ v, post=r.pushScope.declareLocal arg (.word v) | _ => region b out.runtime) _ (entered _ _ hr)
          · change mid=r.pushScope ∧ Frame.isWord v at hv
            obtain ⟨rfl,w,rfl⟩ := hv
            apply Frame.pureValue
            exact ⟨_,rfl⟩
        apply Frame.bind decl; intro out good
        cases out <;> first | exact Frame.pureValue (P:=fun res : Result => region b res.runtime) _ good | skip
        obtain ⟨v,rfl⟩ := good
        let one := r.pushScope.declareLocal arg (.word v)
        let two := ((one.allocMemory (.bytes [])).1).declareLocal ret (.memoryRef one.nextMemory)
        have mem : Stmt.eval (n+1) t c one (.memoryVarDecl .bytesCalldata ret none)=pure (.normal two) := by
          rw [Stmt.eval]; simp [Runtime.declareMemoryLocal,Ty.defaultValue,Ty.coerceValue?,Runtime.memoryStoredValue,Runtime.allocMemory,Bind.bind,Option.bind,two]
        dsimp only
        rw [Stmt.evalList,mem]
        have ready1 := declared b r.pushScope arg (.word v) (by trivial) (entered _ _ hr)
        have ready2 : region b two := declared b _ ret (.memoryRef one.nextMemory) (by trivial) ready1
        apply cons _ _ _ _ _ _ _ (capDecimal b c two (n+1) v rfl ready2)
        intro mid hm
        exact Frame.sequence (by intro s hs; simp at hs; subst s; exact copy _ _ _ _ _) (n+1) mid hm
    · intro result valid; apply Frame.pureValue; cases result <;> exact exited _ _ valid
end Inv39.Init
