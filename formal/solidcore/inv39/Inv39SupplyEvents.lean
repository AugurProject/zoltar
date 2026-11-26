import Inv39EventLayout
import Inv39Terms
open SolidCore.Solidity.Source
namespace Inv39.SupplyEvents
inductive Kind | mint | burn deriving DecidableEq
def name : Kind → String | .mint => "Mint" | .burn => "Burn"
def fields : Kind → List EventField
  | .mint => [⟨.address,true⟩,⟨.uint256,false⟩]
  | .burn => [⟨.address,true⟩,⟨.uint256,false⟩,⟨.uint256,false⟩]
def decl (k : Kind) (topic : Nat) : EventDecl := ⟨name k,1,some topic,fields k⟩
private def check (k : Kind) : Option EventDecl → Bool
  | some ⟨"Mint",1,some _,[⟨.address,true⟩,⟨.uint256,false⟩]⟩ => k == .mint
  | some ⟨"Burn",1,some _,[⟨.address,true⟩,⟨.uint256,false⟩,⟨.uint256,false⟩]⟩ => k == .burn
  | _ => false
private theorem decode (k : Kind) (o : Option EventDecl) (h : check k o) : ∃ t,o=some (decl k t) := by
  unfold check at h
  split at h
  · cases k <;> first | exact ⟨_,rfl⟩ | contradiction
  · cases k <;> first | exact ⟨_,rfl⟩ | contradiction
  · contradiction
private def seen (k : Kind) := check k (model.core.context.eventDecl? (name k))
private theorem present : seen .mint && seen .burn := by native_decide
theorem layout (k : Kind) : ∃ t,model.core.context.eventDecl? (name k) = some (decl k t) := by
  apply decode
  have all := present
  simp only [Bool.and_eq_true] at all
  cases k <;> first | exact all.1 | exact all.2
end Inv39.SupplyEvents
