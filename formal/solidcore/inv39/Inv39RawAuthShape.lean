import Inv39Model
open SolidCore.Solidity.Source
namespace Inv39.Auth
abbrev position : Nat := 56256263192675950574160599367209873035022048130579665343756082292259235426560
abbrev helper := "__internal__authorizationStorage()#[]"
abbrev target := "authorizationStorage"
abbrev result := "_ret__authorizationStorage_0"
abbrev emptyRef := "__solidcore_uninitialized_storage_return"
def layout : StorageLayout := .struct [.mapping .address (.scalar .uint256),.mapping .address (.mapping (.fixedBytes 32) (.scalar .bool))]
def shape : Stmt := .block [.skip,.block [.varDecl (.fixedBytes 32) "location" (some (.word position)),.bindRawSlot target layout (.var "location")]]
private def matchesShape (f : InternalFunction) := match f.params,f.returns,f.body with
  | [],[⟨"authorizationStorage",.uint256,true⟩],
    .block [.skip,.block [.varDecl (.fixedBytes 32) "location" (some (.word w)),.bindRawSlot "authorizationStorage"
      (.struct [.mapping .address (.scalar .uint256),.mapping .address (.mapping (.fixedBytes 32) (.scalar .bool))]) (.var "location")]] => w==position
  | _,_,_=>false
private theorem evidence : ((model.core.table.lookup? helper).map matchesShape)=some true := by native_decide
theorem linked : ∃ f, model.core.table.lookup? helper=some f ∧ f.params=[] ∧ f.returns=[⟨target,.uint256,true⟩] ∧ f.body=shape := by
  have ev := evidence
  cases h:model.core.table.lookup? helper with
  | none => simp [h] at ev
  | some f =>
    simp only [h,Option.map_some,Option.some.injEq] at ev
    refine ⟨f,rfl,?_,?_,?_⟩ <;> unfold matchesShape at ev <;> split at ev <;> simp_all [shape,layout,target]
end Inv39.Auth
