import Inv12ChoiceHistoryStep
open SolidCore.Solidity.Source Inv32Division
namespace Inv12

theorem callbackForChoice (n : Nat) (c : Context) (r : Runtime) (f b : Ref) (rep extra : Nat)
    (src child root addr : Nat) (rows : ScriptedResponder) (one two : EvmCompiler.Simulation.CallResponse)
    (fork : f.bound r "fork") (branch : b.bound r "branch") (chosen : b.hasField 5 4) (total : f.hasField 1 1)
    (source : r.lookupLocal? "source"=some (.word src)) (childVal : r.lookupLocal? "child"=some (.word child))
    (field : r.loadImmutableField c "securityPool"=.ok (.word root))
    (rwrd : root<R) (aw : addr<R) (ar : wordEq root c.self=false) (aa : wordEq addr c.self=false)
    (ok1 : one.success=true) (ok2 : two.success=true)
    (ans1 : rows.answerCall? (snapshotWorld c (afterCredits r f b rep extra).state)
      (buildCallRequest c .staticcall root (wireBytes serviceSelector []) 0 none)=some one)
    (decoded : abiDecodeValuesExcept? [.address] ((byteArrayToBytes one.returnData).map normByte)=.ok [.word addr])
    (code : (rootReply c (afterCredits r f b rep extra) root one).state.envAccountHasCode c addr=true)
    (ans2 : rows.answerCall? one.postWorld (buildCallRequest c .call addr
       (premiumBytes (afterCredits r f b rep extra) f b src child) 0 none)=some two)
    (nw : NoCoordinatorWrites rows) (wf : StorageMap.WF r.state.storage) :
    let a := afterCredits r f b rep extra
    ∃ next, (Stmt.eval (n+15) model.core.table c a (.block callbackCode)).runWith rows=.ok (.normal next) ∧
      next.locals=a.locals ∧ ∀ g off, Ref.get g next.state off=g.get a.state off := by
  let a := afterCredits r f b rep extra
  have localValue (name : String) (other : Inv03.Bodies.tmp≠name) (distinct : "previousCash"≠name) :
      a.lookupLocal? name=r.lookupLocal? name :=
    (lookupOther (credit (credit (saveCash r b) b 3 rep) b 4 extra) name Inv03.Bodies.tmp _ other).trans
      (lookupOther r name "previousCash" _ distinct)
  exact callbackBlock (n+12) c a f b src child root addr rows one two
    (aliasDuringCredit _ _ _ _ _ _ _ fork (by decide) (by decide))
    (aliasDuringCredit _ _ _ _ _ _ _ branch (by decide) (by decide))
    chosen total ((localValue _ (by decide) (by decide)).trans source) ((localValue _ (by decide) (by decide)).trans childVal)
    field rwrd aw ar aa ok1 ok2 ans1 decoded code ans2 nw (Or.inr rfl) (afterCreditsWF r f b rep extra wf)
end Inv12
