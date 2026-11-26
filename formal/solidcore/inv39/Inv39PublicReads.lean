import Inv39ReadCertificates
open SolidCore.Solidity.Source
namespace Inv39.ReadEvidence
 theorem boundArgs (ds : List BindingDecl) (vs : List Value) (fr : Frame)
    (scalar : ds.all fun d => Auth.scalar d.ty) (eq : BindingDecl.bindArgs? ds vs=some fr) : Init.safeFrame fr := by
  induction ds generalizing vs fr with
  | nil => cases vs <;> first | cases eq; simp [Init.safeFrame] | contradiction
  | cons d ds ih =>
    cases vs with
    | nil => contradiction
    | cons v vs =>
      simp only [List.all_cons,Bool.and_eq_true] at scalar
      rw [BindingDecl.bindArgs?] at eq
      cases head:d.bindArg? v with
      | none => simp [head] at eq
      | some p =>
        cases tail:BindingDecl.bindArgs? ds vs with
        | none => simp [head,tail] at eq
        | some rest =>
          simp [head,tail] at eq; subst fr
          intro p hp; rcases List.mem_cons.mp hp with rfl|hp
          · exact ReadDomainEvidence.boundPlain _ _ _ scalar.1 head
          · exact ih vs rest scalar.2 tail _ hp
 theorem initialSafe (f : FunctionDef) (args : List Value) (fr : Frame)
    (ps : f.params.all fun d => Auth.scalar d.ty) (rs : f.returns.all Auth.returnOk)
    (eq : f.initialFrame? args=some fr) : Init.safeFrame fr := by
  unfold FunctionDef.initialFrame? at eq
  cases bound:BindingDecl.bindArgs? f.params args with
  | none => simp [bound] at eq
  | some inputs =>
    simp [bound] at eq; subst fr
    intro p hp; rcases List.mem_append.mp hp with hp|hp
    · exact boundArgs _ _ _ ps bound _ hp
    · obtain ⟨d,hd,rfl⟩ := List.mem_map.mp hp
      exact ReadDomainEvidence.defaultSafe d (List.all_eq_true.mp rs d hd)
/-- Unconditional in storage contents and context; invalid calls are excluded only by success. -/
theorem publicReadStorage (fuel : Nat) (s post : State) (c : Context) (name : String)
    (args out : List Value) (view : name∈Coverage.views)
    (run : SolidCore.Solidity.TypeCheck.CheckedContract.callTargetWithContext? fuel model (.name name) c s args=some (.returned post out)) :
    post.storage=s.storage := by
  unfold SolidCore.Solidity.TypeCheck.CheckedContract.callTargetWithContext? at run
  cases resolved:model.core.resolveCallFunction? (.name name) args with
  | none => simp [resolved] at run
  | some f =>
    rw [resolved] at run
    have find : model.core.functions.find? (fun f => f.name==name && (f.initialFrame? args).isSome)=some f := resolved
    have selected := List.find?_some find
    simp only [Bool.and_eq_true,beq_iff_eq] at selected
    have mem := List.mem_of_find?_eq_some find
    have cert := functionCertificate f mem (selected.1.symm ▸ view)
    simp only [certificate,Bool.and_eq_true] at cert
    obtain ⟨fr,frame⟩ := Option.isSome_iff_exists.mp selected.2
    have good := initialSafe f args fr cert.1.1 cert.1.2 frame
    let rt := (CheckedWordCall.initial c s).withFrame fr
    have safe : Frame.Ensures (Stmt.eval fuel model.core.table c rt f.body)
        (fun res => res.runtime.state.storage=s.storage) := by
      by_cases domain : f.name=="DOMAIN_SEPARATOR"
      · rw [if_pos domain] at cert
        have initial : ReadDomainEvidence.region s rt := by
          refine ⟨rfl,?_⟩
          intro g hg; change g∈[fr] at hg
          exact List.mem_singleton.mp hg ▸ good
        exact Frame.weaken (ReadDomainEvidence.sound _ s _ c (ReadDomainEvidence.extraSafe s c) _ cert.2 fuel rt initial) (fun _ h => h.1)
      · rw [if_neg domain] at cert
        exact statementsSound _ s _ c (helperSound s c) _ cert.2 fuel rt rfl
    change f.call? fuel model.core.table c s args=_ at run
    by_cases ok : f.acceptsValue c.value
    · have start : f.evalBodyEntry fuel model.core.table c s args=
          some (Stmt.eval fuel model.core.table c rt f.body) := by
        unfold FunctionDef.evalBodyEntry; rw [if_pos ok,frame]; rfl
      unfold FunctionDef.call? FunctionDef.call at run
      rw [start] at run
      have liftBody : (Functor.map (f.callBodyResult s) (Stmt.eval fuel model.core.table c rt f.body)).runWith [] =
          ((Stmt.eval fuel model.core.table c rt f.body).runWith [] >>= fun v => .ok (f.callBodyResult s v)) :=
        Fold.bindRun [] _ (fun v => pure (f.callBodyResult s v))
      cases ev:(Stmt.eval fuel model.core.table c rt f.body).runWith [] with
      | error err => simp [liftBody,ev,Bind.bind,Except.bind,Option.bind] at run
      | ok res =>
        have abi : f.callBodyResult s res=.returned post out := by
          simpa [liftBody,ev,Bind.bind,Except.bind,Option.bind] using run
        exact (Init.Marker.abiStorage _ _ _ _ _ abi).trans (Frame.selected safe [] res ev)
    · simp only [FunctionDef.call?,FunctionDef.call,FunctionDef.evalBodyEntry,if_neg ok] at run
      change some (CallResult.reverted s RevertData.empty)=some (.returned post out) at run
      cases run

 theorem publicReadMarker (fuel : Nat) (s post : State) (c : Context) (name : String)
    (args out : List Value) (view : name∈Coverage.views)
    (run : SolidCore.Solidity.TypeCheck.CheckedContract.callTargetWithContext? fuel model (.name name) c s args=some (.returned post out)) :
    post.loadSlot 7=s.loadSlot 7 := by
  simp only [State.loadSlot,publicReadStorage fuel s post c name args out view run]
#print axioms publicReadStorage
#print axioms publicReadMarker
end Inv39.ReadEvidence
