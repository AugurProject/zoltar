import Inv39LogEmissions
open SolidCore.Solidity.Source
namespace Inv39.SupplyEvents
theorem logSuccess (k : Kind) (c : Context) (r : Runtime) (addr val : Nat)
    (fit : abiAddressFits addr) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ post, r.emitEvent c (name k) (values k r.state addr val) = .ok post := by
  obtain ⟨topic,declEq⟩ := layout k
  have found : c.eventDecl? (name k) = some (decl k topic) := by
    change c.eventDecls.find? _ = _
    rw [events]; exact declEq
  have addrTopic : ∃ a, abiEventTopic? .address (.word addr)=some a := by
    simp [abiEventTopic?,Ty.isHashedEventIndexed,abiStaticBytes?,fit]
  obtain ⟨a,A⟩ := addrTopic
  have data1 (v : Nat) : ∃ bs, abiEncodeValues? [.uint256] [.word v]=some bs := by
    simp [abiEncodeValues?,Ty.staticAbiHeadWords?,Ty.listAbiHeadWords?,Ty.abiHeadWords?,abiEncodeValuesAux?,Ty.isDynamicAbi,abiEncodeStaticValue?,abiStaticBytes?]
  have data2 (v w : Nat) : ∃ bs, abiEncodeValues? [.uint256,.uint256] [.word v,.word w]=some bs := by
    simp [abiEncodeValues?,Ty.staticAbiHeadWords?,Ty.listAbiHeadWords?,Ty.abiHeadWords?,abiEncodeValuesAux?,Ty.isDynamicAbi,abiEncodeStaticValue?,abiStaticBytes?]
  obtain ⟨bs1,D1⟩ := data1 val
  obtain ⟨bs2,D2⟩ := data2 val (WordField.stored r.state theoretical)
  have enc : ∃ e, (decl k topic).encodeFields? (values k r.state addr val) = some e := by
    cases k <;> simp [EventDecl.encodeFields?,EventDecl.encodeFields?.encode,decl,fields,A,D1,D2,values,Bind.bind,Option.bind]
  obtain ⟨e,E⟩ := enc
  cases k <;> simp [Runtime.emitEvent,Value.untagFixedBytes,found,E,decl,fields,values,name,Bind.bind,Option.bind] at *
theorem run (k : Kind) (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (addr val : Nat)
    (A : r.lookupLocal? "account"=some (.word addr)) (V : r.lookupLocal? "valueAttoRep"=some (.word val))
    (fit : abiAddressFits addr) (storage : c.storageFields=model.core.context.storageFields)
    (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+1) t c r (.emitEvent (name k) (args k)) = pure (.normal next) ∧
      next.locals=r.locals ∧ next.state.storage=r.state.storage := by
  obtain ⟨post,ok⟩ := logSuccess k c r addr val fit events
  have same := logPreservesStorage _ _ _ _ _ ok
  refine ⟨post,?_,same.2,same.1⟩
  cases k with
  | mint => have h := mintEmission n t c r addr val A V storage events; rw [show name .mint="Mint" from rfl] at ok; simpa [ok] using h
  | burn => have h := burnEmission n t c r addr val A V storage events; rw [show name .burn="Burn" from rfl] at ok; simpa [ok] using h
end Inv39.SupplyEvents
