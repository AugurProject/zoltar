import Inv39ChildWrapper
import Inv39BurnEffect
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Child
def callContext (sender self : Nat) := {model.core.context with sender,self}
theorem resolve (m : TypeCheck.CheckedContract) (f : FunctionDef) (name : String)
    (args : List Source.Value) (frame : Frame) (found : m.core.findFunctionByName? name=some f)
    (fit : f.initialFrame? args=some frame) : m.core.resolveCallFunction? (.name name) args=some f := by
  obtain ⟨ok,before,after,parts,skip⟩ := List.find?_eq_some_iff_append.mp found
  apply List.find?_eq_some_iff_append.mpr
  exact ⟨by simp [ok,fit],before,after,parts,by intro other mem; have absent := skip other mem; simp_all⟩
theorem dispatch (k : Kind) (s : State) (sender self a v : Nat) (next : Runtime)
    (ev : let c := callContext sender self
          Stmt.eval 50000 model.core.table c (enter (CheckedWordCall.initial c s) a v) (shape k).value = pure (.normal next)) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name (entryName k)) (callContext sender self) s [.word a,.word v] =
      some (.returned {next.state with constructorOutput? := none} []) := by
  obtain ⟨f,found,ps,rs,bd⟩ := linked k
  let c := callContext sender self
  let r := enter (CheckedWordCall.initial c s) a v
  have frame : f.initialFrame? [.word a,.word v] = some [("account",.word a),("valueAttoRep",.word v)] := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs]; simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?]
  have ok : f.acceptsValue c.value=true := by simp [c,callContext,FunctionDef.acceptsValue,Contract.context,wordEq]
  have start : f.evalBodyEntry 50000 model.core.table c s [.word a,.word v] =
      some (Stmt.eval 50000 model.core.table c r f.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos ok,frame]; rfl
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [resolve _ _ _ _ _ found frame]
  change f.call? 50000 model.core.table c s [.word a,.word v] = _
  unfold FunctionDef.call? FunctionDef.call
  rw [start,bd]
  change Stmt.eval 50000 _ c r _ = pure (.normal next) at ev
  rw [ev]
  change some (f.callBodyResult s (.normal next)) = _
  simp [FunctionDef.callBodyResult,FunctionDef.collectReturns,rs,collectReturnBindings,collectReturnBindings.collect]
theorem publicBurn (s : State) (A : Nat → Prop) (b : Balances) (sender self addr val : Nat)
    (senderFit : sender<R) (authorized : s.immutable? "zoltar"=some (.word sender))
    (valid : addr<2^160) (nonzero : addr≠0) (seen : A addr) (sep : SlotSeparation A) (book : Books A s b)
    (enough : val≤balance addr b) (solvent : total b ≤ s.loadSlot theoretical.slot) (fit : s.loadSlot theoretical.slot<R) :
    ∃ post, TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "burn") (callContext sender self) s [.word addr,.word val] =
        some (.returned post []) ∧ Books A post (setBalance addr (balance addr b-val) b) ∧
        post.loadSlot theoretical.slot = s.loadSlot theoretical.slot-val := by
  let c := callContext sender self
  let base := CheckedWordCall.initial c s
  let start := (enter base addr val).pushScope.pushScope.pushScope
  have bounds := lt_of_le_of_lt (le_trans (le_trans enough (balanceLE addr b)) solvent) fit
  obtain ⟨out,ev,_,books,observed⟩ := burnEffects 49980 c start A b addr val rfl rfl valid nonzero seen sep
    (Books.ofStorageEq (s:=s) rfl book) enough solvent fit rfl rfl
  have run := wrapAuthorized .burn 49995 model.core.table c base addr val bounds senderFit rfl authorized out ev
  exact ⟨_,dispatch .burn _ _ _ _ _ _ run,Books.ofStorageEq (s:=out.state) rfl books,observed⟩
end Inv39.Child
