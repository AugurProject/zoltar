import Inv39UpdateExecution
open SolidCore.Solidity.Source
namespace Inv39
theorem encoded3 (name : String) (topic src dst val : Nat) (S : abiAddressFits src) (D : abiAddressFits dst) : ∃ e, (⟨name,2,some topic,transferFields⟩ : EventDecl).encodeFields? [.word src,.word dst,.word val] = some e := by
  have addr (x : Nat) (h : abiAddressFits x) : ∃ a, abiEventTopic? .address (.word x)=some a := by simp [abiEventTopic?,Ty.isHashedEventIndexed,abiStaticBytes?,h]
  have data : ∃ bs, abiEncodeValues? [.uint256] [.word val]=some bs := by
    simp [abiEncodeValues?,Ty.staticAbiHeadWords?,Ty.listAbiHeadWords?,Ty.abiHeadWords?,abiEncodeValuesAux?,Ty.isDynamicAbi,abiEncodeStaticValue?,abiStaticBytes?]
  obtain ⟨a,A⟩ := addr src S
  obtain ⟨b,B⟩ := addr dst D
  obtain ⟨bs,H⟩ := data
  simp [EventDecl.encodeFields?,EventDecl.encodeFields?.encode,transferDecl,transferFields,A,B,H,Bind.bind,Option.bind]
theorem emitSuccess (c : Context) (r : Runtime) (src dst val : Nat) (S : abiAddressFits src) (D : abiAddressFits dst) (decls : c.eventDecls=model.core.context.eventDecls) :
    ∃ post, r.emitEvent c "Transfer" [.word src,.word dst,.word val] = .ok post := by
  obtain ⟨topic,lookup⟩ := transferEventDecl
  have found : c.eventDecl? "Transfer" = some (transferDecl topic) := by
    change c.eventDecls.find? _ = _
    rw [decls]; exact lookup
  obtain ⟨e,success⟩ := encoded3 "Transfer" topic src dst val S D
  simp [Runtime.emitEvent, Value.untagFixedBytes,found,transferDecl,success,Bind.bind,Option.bind,transferFields] at *
end Inv39
