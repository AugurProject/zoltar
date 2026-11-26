import Inv39Model
open SolidCore.Solidity.Source
namespace Inv39
def transferFields : List EventField := [⟨.address,true⟩,⟨.address,true⟩,⟨.uint256,false⟩]
def transferDecl (topic : Nat) : EventDecl := ⟨"Transfer",2,some topic,transferFields⟩
private def inspectEvent : Option EventDecl → Bool
  | some ⟨"Transfer",2,some _,[⟨.address,true⟩,⟨.address,true⟩,⟨.uint256,false⟩]⟩ => true
  | _ => false
private theorem decode (f : Option EventDecl) (h : inspectEvent f) : ∃ topic, f=some (transferDecl topic) := by
  unfold inspectEvent at h
  split at h
  · exact ⟨_,rfl⟩
  · contradiction
theorem transferEventDecl : ∃ topic, model.core.context.eventDecl? "Transfer" = some (transferDecl topic) :=
  decode _ (by native_decide)
end Inv39
