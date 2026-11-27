import Inv39SignedInputs
import Inv39SignedBody
import Inv39SignedLink
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
structure ChildAccounts (A : Nat→Prop) (p : Payment) (b : Balances) (s : State) : Prop where
  physical : StorageMap.WF s.storage
  transient : StorageMap.WF s.transient
  fresh : s.envWorld?=none ∨ s.worldMutatedSinceAdoption=true
  from_ : A p.from_
  to_ : A p.to_
  separate : SlotSeparation A
  flag : Separate A (flagSlot p.from_ p.nonce)
  books : Books A s b
  totalFit : total b<R
def paid (A : Nat→Prop) (b : Balances) (p : Payment) (s : State) (q : Runtime) := Moved A b p.from_ p.to_ p.value (s.loadSlot theoretical.slot) q.state
theorem signedHelper (n : Nat) (c : Context) (r : Runtime) (bs : List Source.Byte) (p : Payment) (A : Nat→Prop) (b : Balances)
    (widths : Widths p) (ledger : ChildAccounts A p b r.state)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    Fold.Ensures (Stmt.eval (n+18) model.core.table c (temps r.pushScope bs p) signedCall) (normal (paid A b p r.state)) := by
  obtain ⟨fn,found,ps,rs,early,late,hash,sig,body,ce,cl,ch,cs⟩ := signedLink
  let rt := temps r.pushScope bs p
  let start := {rt with locals:=[innerFrame (hashOf bs) p]}
  let P := normal (paid A b p r.state)
  have enter := signedEnter fn rt (hashOf bs) p widths (Nat.mod_mod _ _) ps rs
  have inner := signedExecution n {c with checked:=true} start A b p early late hash sig widths (innerSeen _ _ _) (innerSafe _ _ _)
    ledger.physical ledger.transient ledger.fresh ledger.from_ ledger.to_ ledger.separate ledger.flag ledger.books ledger.totalFit ce cl ch cs fields events
  rw [←body] at inner
  unfold signedCall; rw [Stmt.eval]; dsimp only
  change Fold.Ensures (do match ← (Expr.evalRefArgList c rt tempNames).caught with
    | .error e=>pure (.reverted rt e)
    | .ok (vs,q)=>match model.core.table.lookup? signedKey with
      | none=>pure (.reverted q RevertData.typeMismatch)
      | some f=>match internalCallEnter? f vs q with
        | none=>pure (.reverted q RevertData.typeMismatch)
        | some (st,ls)=>Stmt.eval (n+17) model.core.table {c with checked:=true} st f.body >>= internalCallFinish f [] ls) P
  rw [actualArgs c r bs p]
  change Fold.Ensures (match model.core.table.lookup? signedKey with
    | none=>pure (Result.reverted rt RevertData.typeMismatch)
    | some f=>match internalCallEnter? f (tempValues (hashOf bs) p) rt with
      | none=>pure (Result.reverted rt RevertData.typeMismatch)
      | some (st,ls)=>Stmt.eval (n+17) model.core.table {c with checked:=true} st f.body >>= internalCallFinish f [] ls) P
  simp only [found,enter]; apply Fold.bind (Q:=P) inner
  intro res ok; cases res with
  | normal q=>simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,internalCallAssign]; exact Fold.pureValue (Result.normal _) P ok
  | reverted q err=>exact Fold.pureValue (Result.reverted q err) P trivial
  | _=>contradiction

theorem captureOnly {t c n r x} (P : Runtime→Prop) (h : Fold.Ensures (Stmt.eval n t c r x) (normal P)) :
    Fold.Ensures (Stmt.eval (n+1) t c r (.captureReturn [] x)) (normal P) := by
  rw [Stmt.eval]; apply Fold.bind (Q:=normal P) h
  intro res ok; cases res with
  | normal q=>exact Fold.pureValue (Result.normal q) _ ok
  | reverted q e=>exact Fold.pureValue (Result.reverted q e) _ trivial
  | _=>contradiction
end Inv39.Auth
