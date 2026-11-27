import Inv39EmitSuccess
import Inv39AllowanceTerms
open SolidCore.Solidity.Source
namespace Inv39.Allowance
def approvalDecl (topic : Nat) : EventDecl := ⟨"Approval",2,some topic,transferFields⟩
private def test : Option EventDecl → Bool
  | some ⟨"Approval",2,some _,[⟨.address,true⟩,⟨.address,true⟩,⟨.uint256,false⟩]⟩=>true | _=>false
private theorem decode (d : Option EventDecl) (yes : test d) : ∃ n, d=some (approvalDecl n) := by
  unfold test at yes; split at yes <;> first | exact ⟨_,rfl⟩ | contradiction
theorem declaration : ∃ n, model.core.context.eventDecl? "Approval"=some (approvalDecl n) := decode _ (by native_decide)
theorem emit (c : Context) (r : Runtime) (t : FunctionTable) (n o s v : Nat) (O : r.lookupLocal? "owner"=some (.word o))
    (S : r.lookupLocal? "spender"=some (.word s)) (V : r.lookupLocal? "value"=some (.word v)) (ofit : abiAddressFits o) (sfit : abiAddressFits s)
    (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ post, Stmt.eval (n+1) t c r approvalLog.value=pure (.normal post) ∧ post.state.storage=r.state.storage ∧ post.locals=r.locals := by
  obtain ⟨topic,decl⟩ := declaration
  have found : c.eventDecl? "Approval"=some (approvalDecl topic) := by change c.eventDecls.find? _ = _; rw [events]; exact decl
  have ev := emitThree "Approval" "owner" "spender" "value" topic c t r n o s v O S V found
  obtain ⟨encoded,ok⟩ := encoded3 "Approval" topic o s v ofit sfit
  have success : ∃ next, r.emitEvent c "Approval" [.word o,.word s,.word v]=.ok next := by
    simp [Runtime.emitEvent,Value.untagFixedBytes,found,approvalDecl,ok,Bind.bind,Option.bind,transferFields] at *
  obtain ⟨next,logged⟩ := success
  obtain ⟨store,locals⟩ := logPreservesStorage _ _ _ _ _ logged
  refine ⟨next,?_,store,locals⟩
  rw [show approvalLog.value=Stmt.emitEvent "Approval" [.var "owner",.var "spender",.var "value"] from rfl,ev]
  simp [event3Result,logged]
end Inv39.Allowance
