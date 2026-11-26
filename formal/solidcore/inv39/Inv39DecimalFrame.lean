import Inv39FrameGrammar
import Inv39Model
open SolidCore.Solidity.Source
namespace Inv39.Decimal
abbrev key := "__internal___library_DecimalStrings_toString(uint256)#[SolidCore.Solidity.Ty.uint 256]"
private def metadata (f : InternalFunction) := match f.params,f.returns with
  | [⟨"absoluteValue",.uint256,false⟩],[⟨"_ret0",.bytesCalldata,false⟩] => true | _,_ => false
private theorem tested : ((model.core.table.lookup? key).map (fun f => metadata f && Frame.stmts f.body)) = some true := by native_decide
private theorem certify (o : Option InternalFunction) (h : (o.map fun f => metadata f && Frame.stmts f.body)=some true) :
    ∃ f, o=some f ∧ f.params=[⟨"absoluteValue",.uint256,false⟩] ∧ f.returns=[⟨"_ret0",.bytesCalldata,false⟩] ∧ Frame.stmts f.body := by
  cases o with
  | none => contradiction
  | some f =>
    simp only [Option.map_some,Option.some.injEq,Bool.and_eq_true] at h
    obtain ⟨metaOk,b⟩ := h
    refine ⟨f,rfl,?_,?_,b⟩ <;> unfold metadata at metaOk <;> split at metaOk <;> simp_all
def linked := certify _ tested
theorem preserves (f : InternalFunction) (atKey : model.core.table.lookup? key=some f) (n : Nat) (c : Context) (r : Runtime)
    (good : Frame.plainEnv r.locals) : Frame.Ensures (Stmt.eval n model.core.table c r f.body) (fun res => res.runtime.state.storage=r.state.storage) := by
  obtain ⟨g,found,_,_,safe⟩ := linked
  rw [atKey] at found; cases found
  exact Frame.weaken (Frame.stmtsSound r.state model.core.table c _ safe n r ⟨rfl,good⟩) fun _ h => h.1
end Inv39.Decimal
