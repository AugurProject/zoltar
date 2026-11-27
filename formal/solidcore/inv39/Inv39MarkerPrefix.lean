import Inv39MarkerPrefixCleanup
import Inv39MarkerPrefixStore
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
set_option maxHeartbeats 4000000
namespace Inv39.Init.Marker.Prefix

theorem syntaxHead (c : Context) (r : Runtime) (s : Source.Stmt) (tail : List Source.Stmt) (out : Result)
    (ok : guardSyntax s=true)
    (run : (Source.Stmt.evalList 49995 model.core.table c r (s::tail)).runWith []=.ok out)
    (nonrev : ∀ q err, out≠.reverted q err) :
    (Source.Stmt.eval 49995 model.core.table c r s).runWith []=.ok (.normal r) ∧
    (Source.Stmt.evalList 49995 model.core.table c r tail).runWith []=.ok out := by
  obtain ⟨e,reason,rfl,read⟩ := guardSyntaxSound s ok
  exact requireHead 49994 _ _ _ _ _ _ _ read run nonrev

/-- Actual prefix and suffix of one successful public initializer execution.
The suffix is the precise tail of the identified initializer body, and executes
from the real REP-store output. No suffix footprint or desired postcondition is
assumed. The normalized marker conclusion concerns that store output. -/
structure Execution (c : Context) (rep : Nat) (post : State) where
  fn : FunctionDef
  a : Source.Stmt
  b : Source.Stmt
  d : Source.Stmt
  e : Source.Stmt
  suffix : List Source.Stmt
  cleaned : Runtime
  start : Runtime
  store : Runtime
  marked : Runtime
  result : Result
  found : model.core.findFunctionByName? "initialize"=some fn
  bodyIdentity : fn.body=Repeat.body (a::repGuard::b::d::e::repStore::suffix)
  cleanedLocal : cleaned.lookupLocal? "repNumber_"=some (.word (Shared.norm rep))
  startIdentity : start=cleaned.pushScope.pushScope.pushScope
  modifierRun : (Source.Stmt.eval 49997 model.core.table c cleaned.pushScope.pushScope authorityGuard).runWith []=.ok (.normal cleaned.pushScope.pushScope)
  markerGuardRun : (Source.Stmt.eval 49995 model.core.table c start Repeat.markerGuard).runWith []=.ok (.normal start)
  universeGuardRun : (Source.Stmt.eval 49995 model.core.table c start a).runWith []=.ok (.normal start)
  guardLocal : start.lookupLocal? "repNumber_"=some (.word (Shared.norm rep))
  repGuardRun : (Source.Stmt.eval 49995 model.core.table c start repGuard).runWith []=.ok (.normal start)
  capGuardRun : (Source.Stmt.eval 49995 model.core.table c start b).runWith []=.ok (.normal start)
  capNonzeroRun : (Source.Stmt.eval 49995 model.core.table c start d).runWith []=.ok (.normal start)
  universeIdentity : e=universeStore
  universeRun : (Source.Stmt.eval 49995 model.core.table c start e).runWith []=.ok (.normal store)
  storeLocal : store.lookupLocal? "repNumber_"=some (.word (Shared.norm rep))
  repStoreRun : (Source.Stmt.eval 49995 model.core.table c store repStore).runWith []=.ok (.normal marked)
  suffixRun : (Source.Stmt.evalList 49995 model.core.table c marked suffix).runWith []=.ok result
  postStorage : post.storage=result.runtime.state.storage
  nonreverting : ∀ q err, result≠.reverted q err
  storedMarker : Shared.norm (marked.state.loadSlot 7)=Shared.norm rep
  storedNonzero : Shared.norm (marked.state.loadSlot 7)≠0

theorem initializerPrefix (s post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) s [.word uid,.word cap,.word rep]=some (.returned post out)) :
    Nonempty (Execution (Child.callContext sender self) rep post) := by
  let c := Child.callContext sender self
  obtain ⟨f,a,b,d,e,suffix,three,outer,found,body,look,rest,storage,nonrev⟩ :=
    cleanedEntry s post sender self uid cap rep out run
  have valid := prefixOfBody f a b d e suffix found body
  simp only [prefixValid,Bool.and_eq_true] at valid
  have eEq := universeSyntaxSound e valid.2
  have groupRun := singletonExecution _ _ _ _ _ _ rest
  obtain ⟨group,groupRun,outerEq⟩ := blockExecution 49998 _ _ _ _ _ groupRun
  have groupNR := popNotReverted group (outerEq ▸ nonrev)
  have groupStore := storage.trans (outerEq ▸ popStorage group)
  have modifierRun := singletonExecution _ _ _ _ _ _ groupRun
  obtain ⟨modifier,modifierRun,groupEq⟩ := blockExecution 49997 _ _ _ _ _ modifierRun
  have modifierNR := popNotReverted modifier (groupEq ▸ groupNR)
  have modifierStore := groupStore.trans (groupEq ▸ popStorage modifier)
  have authRead : Frame.ReadOnly (.binary .eq .caller (.immutable "zoltar")) := by
    exact reads _ (by decide)
  obtain ⟨authRun,captureRun⟩ := requireHead 49996 _ _ _ _ _ _ _ authRead modifierRun modifierNR
  have captureRun := singletonExecution _ _ _ _ _ _ captureRun
  obtain ⟨captured,capturedRun,captureEq⟩ := captureExecution 49996 _ _ _ _ _ captureRun
  have capturedStore : post.storage=captured.runtime.state.storage := by
    cases captured <;> simpa only [captureEq,Result.runtime] using modifierStore
  have capturedNR : ∀ q err, captured≠.reverted q err := by
    intro q err eq; subst captured; exact modifierNR q err captureEq
  obtain ⟨inner,innerRun,innerEq⟩ := blockExecution 49995 _ _ _ _ _ capturedRun
  have innerStore := capturedStore.trans (innerEq ▸ popStorage inner)
  have innerNR := popNotReverted inner (innerEq ▸ capturedNR)
  let start := three.pushScope.pushScope.pushScope
  have startLook : start.lookupLocal? "repNumber_"=some (.word (Shared.norm rep)) := by
    simpa [start,Runtime.pushScope,Runtime.lookupLocal?,LocalEnv.lookup?,Source.Frame.lookup?] using look
  obtain ⟨markerRun,rest⟩ := syntaxHead c start Repeat.markerGuard _ inner (by decide) innerRun innerNR
  obtain ⟨universeGuard,rest⟩ := syntaxHead c start a _ inner valid.1.1.1 rest innerNR
  obtain ⟨repGuardRun,rest⟩ := syntaxHead c start repGuard _ inner (by decide) rest innerNR
  obtain ⟨capGuard,rest⟩ := syntaxHead c start b _ inner valid.1.1.2 rest innerNR
  obtain ⟨capNonzero,rest⟩ := syntaxHead c start d _ inner valid.1.2 rest innerNR
  obtain ⟨head,universeRun,rest⟩ := listExecution 49995 _ _ start e _ inner rest
  have shape := universeShape 49994 c start rfl
  unfold Fold.Ensures at shape
  rw [eEq] at universeRun
  have shape := shape head universeRun
  cases head with
  | normal store =>
    have storeLook : store.lookupLocal? "repNumber_"=some (.word (Shared.norm rep)) := by
      change store.locals.lookup? _ = _
      rw [shape]
      exact startLook
    have stored := storeExec c store (Shared.norm rep) 49994 rfl storeLook
    obtain ⟨head,repStoreRun,suffixRun⟩ := listExecution 49995 _ _ store repStore suffix inner rest
    rw [stored] at repStoreRun
    have eq := Except.ok.inj repStoreRun
    subst head
    let marked : Runtime := {store with state:=store.state.storeSlot 7 (Shared.norm (Shared.norm rep))}
    have nz := guardNonzero c start start (Shared.norm rep) 49994 startLook repGuardRun
    have idem : Shared.norm (Shared.norm rep)=Shared.norm rep := Nat.mod_mod _ _
    rw [idem] at nz
    have atStore : marked.state.loadSlot 7=Shared.norm rep := by
      change (store.state.storeSlot 7 (Shared.norm (Shared.norm rep))).loadSlot 7=_
      rw [idem]
      exact loadChanged _ _ _ (Nat.mod_lt _ (by decide))
    have normalized : Shared.norm (marked.state.loadSlot 7)=Shared.norm rep := by rw [atStore,idem]
    refine ⟨{
      fn := f
      a := a
      b := b
      d := d
      e := e
      suffix := suffix
      cleaned := three
      start := start
      store := store
      marked := marked
      result := inner
      found := found
      bodyIdentity := body
      cleanedLocal := look
      startIdentity := rfl
      modifierRun := authRun
      markerGuardRun := markerRun
      universeGuardRun := universeGuard
      guardLocal := startLook
      repGuardRun := repGuardRun
      capGuardRun := capGuard
      capNonzeroRun := capNonzero
      universeIdentity := eEq
      universeRun := ?_
      storeLocal := storeLook
      repStoreRun := ?_
      suffixRun := suffixRun
      postStorage := innerStore
      nonreverting := innerNR
      storedMarker := normalized
      storedNonzero := normalized ▸ nz
    }⟩
    · rwa [eEq]
    · rw [stored]; rfl
  | reverted q err => exact False.elim (innerNR q err rest)
  | _ => contradiction
end Inv39.Init.Marker.Prefix
