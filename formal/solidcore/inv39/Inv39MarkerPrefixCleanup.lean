import Inv39MarkerPrefixBody
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
set_option maxHeartbeats 4000000
namespace Inv39.Init.Marker.Prefix

theorem cleanedEntry (s post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) s [.word uid,.word cap,.word rep]=some (.returned post out)) :
    let c := Child.callContext sender self
    ∃ f a b d e suffix, ∃ (three : Runtime) (inner : Result),
      model.core.findFunctionByName? "initialize"=some f ∧
      f.body=Repeat.body (a::repGuard::b::d::e::repStore::suffix) ∧
      three.lookupLocal? "repNumber_"=some (.word (Shared.norm rep)) ∧
      (Source.Stmt.evalList 49999 model.core.table c three
        [.block [.block [authorityGuard,.captureReturn []
          (.block (Repeat.markerGuard::a::repGuard::b::d::e::repStore::suffix))]]]).runWith []=.ok inner ∧
      post.storage=inner.runtime.state.storage ∧
      (∀ q err, inner≠.reverted q err) := by
  intro c
  let r := ((CheckedWordCall.initial c s).withFrame [("universeId_",.word uid),("totalTheoreticalSupplyAttoRep_",.word cap),("repNumber_",.word rep)]).pushScope
  obtain ⟨f,a,b,d,e,suffix,res,found,body,bodyRun,abi⟩ := bodyEntry s post sender self uid cap rep out run
  obtain ⟨inner,inside,resEq⟩ := blockExecution 49999 _ _ _ _ _ bodyRun
  have storage : post.storage=inner.runtime.state.storage :=
    (abiStorage f s post res out abi).trans (resEq ▸ popStorage inner)
  have nonrev : ∀ q err, inner≠.reverted q err := by
    apply popNotReverted
    exact resEq ▸ abiNotReverted f s post res out abi
  have safe : Auth.safeEnv r.locals := by
    intro f hf p hp
    simp only [r,Runtime.pushScope,Runtime.withFrame,CheckedWordCall.initial,
      List.mem_cons,List.not_mem_nil,or_false] at hf
    rcases hf with rfl|rfl
    · simp at hp
    · simp only [List.mem_cons,List.not_mem_nil,or_false] at hp
      rcases hp with rfl|rfl|rfl <;> exact Or.inr trivial
  have active : r.locals≠[] := by simp [r,Runtime.pushScope]
  have guard (bits : Nat) (name : String) (hidden : watch name=false) (ordinary : Auth.ordinary name=true) :
      Auth.guards false watch model.core.table c (Repeat.cleanup bits name) := by
    apply Auth.simpleSound
    simp [Repeat.cleanup,Auth.simple,Auth.writable,hidden,ordinary,Auth.pureExpr]
  have noWatch (bits : Nat) (name : String) (ordinary : Auth.ordinary name=true) :
      Auth.guards false (fun _ => false) model.core.table c (Repeat.cleanup bits name) := by
    apply Auth.simpleSound
    simp [Repeat.cleanup,Auth.simple,Auth.writable,ordinary,Auth.pureExpr]
  obtain ⟨one,first,rest,safe1,active1⟩ := normalListHead _ _ _ r _ _ inner safe active
    (noWatch 248 _ (by decide)) inside nonrev
  obtain ⟨two,second,rest,safe2,active2⟩ := normalListHead _ _ _ one _ _ inner safe1 active1
    (noWatch 256 _ (by decide)) rest nonrev
  obtain ⟨three,third,rest,_,_⟩ := normalListHead _ _ _ two _ _ inner safe2 active2
    (noWatch 256 _ (by decide)) rest nonrev
  have h1 := Auth.guarding 49999 r safe active (guard 248 "universeId_" (by decide) (by decide))
  unfold Fold.Ensures at h1
  have rel1 : Auth.Relative watch c r one := h1 _ first
  have h2 := Auth.guarding 49999 one rel1.safe (Auth.active rel1 active)
    (guard 256 "totalTheoreticalSupplyAttoRep_" (by decide) (by decide))
  unfold Fold.Ensures at h2
  have rel2 : Auth.Relative watch c one two := h2 _ second
  have look : two.lookupLocal? "repNumber_"=some (.word rep) := by
    rw [relativeLookup rel2,relativeLookup rel1]
    rfl
  exact ⟨f,a,b,d,e,suffix,three,inner,found,body,cleanupResult c two three rep 49998 look third,rest,storage,nonrev⟩
end Inv39.Init.Marker.Prefix
