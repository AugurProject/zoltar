import Inv39Model
import Inv39History
import Inv39WordField
import Inv32Shapes
open SolidCore.Solidity.Source Inv39.WordField
namespace Inv39
def circulating : Field := ⟨"_totalSupply",2⟩
def theoretical : Field := ⟨"totalTheoreticalSupplyAttoRep",5⟩
def balances (s : State) : Supply := ⟨stored s theoretical,stored s circulating⟩
def namedField (k : Field) : Inv32Shapes.Pattern (Option StorageField) :=
  ⟨some k.field,
    fun | some ⟨n,s,some .uint256,some (.scalar .uint256),false,0,32,false⟩ => n==k.name && s==k.slot | _ => false,
    by intro f h; dsimp only at h; split at h
       · simp only [Bool.and_eq_true, beq_iff_eq] at h
         obtain ⟨rfl,rfl⟩ := h
         rfl
       · contradiction⟩
def fieldsChecked := (namedField circulating).test (model.core.context.storageField? circulating.name) &&
  (namedField theoretical).test (model.core.context.storageField? theoretical.name)
private theorem layoutPass : fieldsChecked := by native_decide
theorem layout : model.core.context.storageField? circulating.name = some circulating.field ∧
    model.core.context.storageField? theoretical.name = some theoretical.field := by
  have h := layoutPass
  simp only [fieldsChecked,Bool.and_eq_true] at h
  exact ⟨(namedField _).sound _ h.1,(namedField _).sound _ h.2⟩
end Inv39
