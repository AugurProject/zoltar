import Inv39RepeatPrefix
open SolidCore.Solidity SolidCore.Solidity.Source
set_option maxHeartbeats 4000000
namespace Inv39.Init.Repeat
theorem bodyDead (n : Nat) (c : Context) (b : State) (tail : List Source.Stmt)
    (fields : c.storageFields=model.core.context.storageFields)
    (nonzero : Shared.norm (b.loadSlot 7)≠0) : Dead (n+6) c b (body tail) := by
  have inner := captureDead (markerDead n c b tail fields nonzero)
  have modifier : Dead (n+4) c b (.block [authorityGuard,.captureReturn [] (.block (markerGuard::tail))]) := by
    apply blockDead
    intro r hr
    exact consDead (guardStep _ c b r hr) (singletonDead inner)
  have group := blockDead (singletonDead modifier)
  unfold body
  apply blockDead
  intro r hr
  apply consDead (cleanStep _ _ _ c b r hr (by decide))
  intro r hr
  apply consDead (cleanStep _ _ _ c b r hr (by decide))
  intro r hr
  apply consDead (cleanStep _ _ _ c b r hr (by decide))
  exact singletonDead group
/-- A successful public initialization requires the normalized existing REP marker to be zero.
No range, authorization, immutable-layout, or storage well-formedness premise is imposed. -/
theorem successMarkerZero (before post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) before [.word uid,.word cap,.word rep]=some (.returned post out)) :
    Shared.norm (before.loadSlot 7)=0 := by
  by_contra nonzero
  obtain ⟨f,tail,found,ps,rs,bd⟩ := binding
  let c := Child.callContext sender self
  let locals := [("universeId_",Source.Value.word uid),("totalTheoreticalSupplyAttoRep_",.word cap),("repNumber_",.word rep)]
  have frame : f.initialFrame? [.word uid,.word cap,.word rep]=some locals := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs]; simp [params,BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?,locals]
  let r := (CheckedWordCall.initial c before).withFrame locals
  have ready : Ready before r := by
    refine ⟨⟨rfl,?_⟩,by simp [r,Runtime.withFrame]⟩
    change Frame.plainEnv [locals]
    intro f hf
    have eq := List.mem_singleton.mp hf
    subst f
    intro p hp
    simp only [locals,List.mem_cons,List.not_mem_nil,or_false] at hp
    rcases hp with rfl|rfl|rfl <;> trivial
  have ok : f.acceptsValue c.value := by simp [c,Child.callContext,FunctionDef.acceptsValue,Contract.context,wordEq]
  have start : f.evalBodyEntry 50000 model.core.table c before [.word uid,.word cap,.word rep]=
      some (Source.Stmt.eval 50000 model.core.table c r f.body) := by
    unfold FunctionDef.evalBodyEntry; rw [if_pos ok,frame]; rfl
  have rejected := bodyDead 49994 c before tail rfl nonzero r ready
  rw [←bd] at rejected
  unfold TypeCheck.CheckedContract.callTargetWithContext? at run
  rw [Child.resolve _ _ _ _ _ found frame] at run
  change f.call? 50000 model.core.table c before [.word uid,.word cap,.word rep]=_ at run
  unfold FunctionDef.call? FunctionDef.call at run
  rw [start] at run
  have tagged : Fold.Ensures ((f.callBodyResult before) <$> Source.Stmt.eval 50000 model.core.table c r f.body)
      (fun result=> match result with | .reverted _ _=>True | _=>False) := by
    apply Fold.bind rejected
    intro result h; cases result <;> first | contradiction | exact Fold.pureValue _ _ trivial
  cases ev:SolI.runWith [] (Functor.map (f.callBodyResult before) (Source.Stmt.eval 50000 model.core.table c r f.body)) with
  | error err=>simp [ev,Option.map,Option.bind] at run
  | ok result=>
    simp [ev,Option.map,Option.bind] at run
    subst result
    unfold Fold.Ensures at tagged
    exact tagged _ ev
/-- Corrected repeat-initialization exclusion for arbitrary model states and calldata words. -/
theorem publicExclusion (before post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (marker : Shared.norm (before.loadSlot 7)≠0) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) before [.word uid,.word cap,.word rep]≠some (.returned post out) :=
  fun run=>marker (successMarkerZero before post sender self uid cap rep out run)
/-- In canonical EVM storage, the ordinary nonzero stored-marker premise suffices. -/
theorem canonicalPublicExclusion (before post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (canonicalStorage : canonical before) (marker : before.loadSlot 7≠0) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) before [.word uid,.word cap,.word rep]≠some (.returned post out) := by
  apply publicExclusion
  have norm : Shared.norm (before.loadSlot 7)=before.loadSlot 7 := Nat.mod_eq_of_lt (canonicalStorage 7)
  rwa [norm]
#print axioms successMarkerZero
#print axioms publicExclusion
#print axioms canonicalPublicExclusion
end Inv39.Init.Repeat
