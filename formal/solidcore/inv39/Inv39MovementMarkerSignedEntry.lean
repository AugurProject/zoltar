import Inv39MovementMarkerSignedCall
import Inv39SignedEntry
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Auth
theorem wrappedPaymentMarker (n : Nat) (c : Context) (rt : Runtime) (bs : List Source.Byte) (p : Payment) (A : Nat→Prop) (b : Balances)
    (widths : Widths p) (seen : Seen p rt) (ledger : ChildAccounts A p b rt.state)
    (marker : BalanceApart A) (flagMarker : Init.MarkerHistory.Apart (flagSlot p.from_ p.nonce))
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    Fold.Ensures (Stmt.eval (n+20) model.core.table c rt (wrap bs)) (normal (paidMarker A b p rt.state)) := by
  unfold wrap; apply inBlock (P:=paidMarker A b p rt.state)
  · rw [temporaries (n+18) c rt.pushScope p bs _ widths (seenPush seen)]
    apply endWith; exact captureOnly _ (signedHelperMarker n c rt bs p A b widths ledger marker flagMarker fields events)
  · exact fun _ h=>h
theorem publicPaymentMarker (n : Nat) (receive_ : Bool) (c : Context) (r : Runtime) (bs : List Source.Byte) (p : Payment) (A : Nat→Prop) (b : Balances)
    (widths : Widths p) (seen : Seen p r) (ledger : ChildAccounts A p b r.state)
    (marker : BalanceApart A) (flagMarker : Init.MarkerHistory.Apart (flagSlot p.from_ p.nonce))
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    Fold.Ensures (Stmt.eval (n+22) model.core.table c r (publicShape receive_ bs)) (normal (paidMarker A b p r.state)) := by
  unfold publicShape; apply inBlock (P:=paidMarker A b p r.state)
  · rw [signedParameters (n+20) c model.core.table r.pushScope p _ widths (seenPush seen)]
    apply endWith; apply inBlock (P:=paidMarker A b p r.state)
    · have receipt := endWith _ _ _ _ _ (wrappedPaymentMarker n c r.pushScope.pushScope bs p A b widths (seenPush (seenPush seen)) ledger marker flagMarker fields events)
      cases receive_ with
      | false=>exact receipt
      | true=>
        apply pass (requireOnly (n+19) c _ r.pushScope.pushScope _ _ (readSound (.binary .eq (.var "to") .caller) rfl))
        intro q h; subst q; exact receipt
    · exact fun _ h=>h
  · exact fun _ h=>h
theorem actualPaymentMarker (receive_ : Bool) (c : Context) (s post : State) (p : Payment) (out : List Source.Value) (A : Nat→Prop) (b : Balances)
    (widths : Widths p) (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (noValue : c.value=0)
    (S : A p.from_) (D : A p.to_) (sep : SlotSeparation A) (flag : Separate A (flagSlot p.from_ p.nonce)) (book : Books A s b) (fit : total b<R)
    (marker : BalanceApart A) (flagMarker : Init.MarkerHistory.Apart (flagSlot p.from_ p.nonce))
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name (publicName receive_)) c s (signedArgs p)=some (.returned post out)) :
    MovedMarker A b p.from_ p.to_ p.value (s.loadSlot theoretical.slot) (s.loadSlot 7) post := by
  obtain ⟨f,found,ps,rs,bs,body⟩ := wrapperLinked receive_
  let rt := (CheckedWordCall.initial c s).withFrame (signedFrame p)
  have frame : f.initialFrame? (signedArgs p)=some (signedFrame p) := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs]; simp [signedArgs,signedFrame,signedParams,BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?]
  let P := fun physical : StorageMap=>MovedMarker A b p.from_ p.to_ p.value (s.loadSlot theoretical.slot) (s.loadSlot 7) {s with storage:=physical}
  have seen : Seen p rt := by constructor <;> rfl
  have ledger : ChildAccounts A p b rt.state := ⟨wf,tf,.inr rfl,S,D,sep,flag,Books.ofStorageEq (s:=s) rfl book,fit⟩
  have obs : P post.storage := by
    apply entryStorage P s post c f (publicName receive_) _ out _ 50000 found frame (by simp [FunctionDef.acceptsValue,noValue,wordEq]) _ run
    rw [body]; apply Fold.weaken (publicPaymentMarker 49978 receive_ c rt bs p A b widths seen ledger marker flagMarker fields events)
    intro res paidOk; cases res with
    | normal q=>exact ⟨paidOk.funded,Books.ofStorageEq (s:=q.state) rfl paidOk.books,paidOk.cap,paidOk.marker⟩
    | _=>first | exact paidOk | contradiction
  exact ⟨obs.funded,Books.ofStorageEq (s:={s with storage:=post.storage}) rfl obs.books,obs.cap,obs.marker⟩
end Inv39.Auth
