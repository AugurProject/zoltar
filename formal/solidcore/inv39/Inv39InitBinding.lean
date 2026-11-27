import Inv39InitSyntax
open SolidCore.Solidity.Source
namespace Inv39.Init
def params : List BindingDecl := [⟨"universeId_",.uint256,false⟩,⟨"totalTheoreticalSupplyAttoRep_",.uint256,false⟩,⟨"repNumber_",.uint256,false⟩]
private def functionMeta (f : FunctionDef) := match f.params,f.returns with
  | [⟨"universeId_",.uint256,false⟩,⟨"totalTheoreticalSupplyAttoRep_",.uint256,false⟩,⟨"repNumber_",.uint256,false⟩],[] => true | _,_ => false
private theorem checked : ((model.core.findFunctionByName? "initialize").map fun f=>functionMeta f && accepts f.body)=some true := by native_decide
private theorem certify (o : Option FunctionDef) (ok : (o.map fun f=>functionMeta f && accepts f.body)=some true) :
    ∃ f, o=some f ∧ f.params=params ∧ f.returns=[] ∧ accepts f.body := by
  cases o with
  | none => contradiction
  | some f =>
    simp only [Option.map_some,Option.some.injEq,Bool.and_eq_true] at ok
    obtain ⟨metaOk,b⟩ := ok; refine ⟨f,rfl,?_,?_,b⟩ <;> unfold functionMeta at metaOk <;> split at metaOk <;> simp_all [params]
theorem linked : ∃ f, model.core.findFunctionByName? "initialize"=some f ∧ f.params=params ∧ f.returns=[] ∧ accepts f.body := certify _ checked
end Inv39.Init
