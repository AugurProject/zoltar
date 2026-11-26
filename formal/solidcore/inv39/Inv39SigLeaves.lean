import Inv39GuardSyntax
open SolidCore.Solidity.Source
namespace Inv39.Auth
def noWatch : Watch := fun _=>false
def noExtra : Extra := fun _=>false
def leafNames : List String := ["__internal_name()#[]",
"__internal__msgSender()#[]",
"__internal___library_AuthorizationSignatures_domainSeparator(bytes32,bytes32,address)#[SolidCore.Solidity.Ty.bytesN 32, SolidCore.Solidity.Ty.bytesN 32, SolidCore.Solidity.Ty.address false]",
"__internal___library_AuthorizationSignatures_hashTypedData(bytes32,bytes32)#[SolidCore.Solidity.Ty.bytesN 32, SolidCore.Solidity.Ty.bytesN 32]",
"__internal___library_AuthorizationSignatures_recover(bytes32,uint8,bytes32,bytes32)#[SolidCore.Solidity.Ty.bytesN 32,\n SolidCore.Solidity.Ty.uint 8,\n SolidCore.Solidity.Ty.bytesN 32,\n SolidCore.Solidity.Ty.bytesN 32]"]
def returnOk (d : BindingDecl) := !d.isStorageRef && (scalar d.ty || (match d.ty with | .bytesCalldata => true | _=>false))
def signatureOk (f : InternalFunction) := f.params.all (fun d=>scalar d.ty) && f.returns.all returnOk
def leafAt (name : String) := ((model.core.table.lookup? name).map (fun f => signatureOk f && accepted noExtra true noWatch f.body)).getD false
private theorem checked : leafNames.all leafAt := by native_decide
theorem leaf (name : String) (listed : name∈leafNames) :
    ∃ f,model.core.table.lookup? name=some f ∧ signatureOk f ∧ ∀ c,guards true noWatch model.core.table c f.body := by
  have ok := List.all_eq_true.mp checked name listed
  unfold leafAt at ok
  cases eq:model.core.table.lookup? name with
  | none=>simp [eq] at ok
  | some f=>
    simp only [eq,Option.map_some,Option.getD_some,Bool.and_eq_true] at ok
    exact ⟨f,rfl,ok.1,fun c=>acceptedSound _ _ _ _ _ (by simp [noExtra]) _ ok.2⟩
end Inv39.Auth
