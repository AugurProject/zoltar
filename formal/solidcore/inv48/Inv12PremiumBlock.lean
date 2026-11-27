import Inv12GetterFrame
import Inv12PremiumExecution
import Inv12TwoResponses
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

def viewName := "#view55792"
def callbackTemps (r : Runtime) (addr : Nat) := (getterStart r addr).declareLocal viewName (.word addr)
def callbackCode : List Source.Stmt := [.varDecl .address Inv03.Bodies.tmp none,rootGetter,
  .varDecl .address viewName (some (.var Inv03.Bodies.tmp)),premiumCall serviceAddress premiumData]
def interaction (r : Runtime) (f b : Ref) (src child addr : Nat) (out : EvmCompiler.Simulation.CallResponse) :=
  ExternalInteraction.lowLevelCall (decodeCallResponse out .call addr (premiumBytes r f b src child) 0 none)

theorem callbackBlock (n : Nat) (c : Context) (r : Runtime) (f b : Ref) (src child root addr : Nat)
    (rows : ScriptedResponder) (one two : EvmCompiler.Simulation.CallResponse)
    (fork : f.bound r "fork") (branch : b.bound r "branch") (chosen : b.hasField 5 4) (total : f.hasField 1 1)
    (source : r.lookupLocal? "source"=some (.word src)) (childVal : r.lookupLocal? "child"=some (.word child))
    (field : r.loadImmutableField c "securityPool"=.ok (.word root))
    (rwrd : root<Inv32Division.R) (aw : addr<Inv32Division.R) (ar : wordEq root c.self=false) (aa : wordEq addr c.self=false)
    (ok1 : one.success=true) (ok2 : two.success=true)
    (ans1 : rows.answerCall? (snapshotWorld c r.state) (buildCallRequest c .staticcall root (wireBytes serviceSelector []) 0 none)=some one)
    (decoded : abiDecodeValuesExcept? [.address] ((byteArrayToBytes one.returnData).map normByte)=.ok [.word addr])
    (code : (rootReply c r root one).state.envAccountHasCode c addr=true)
    (ans2 : rows.answerCall? one.postWorld (buildCallRequest c .call addr (premiumBytes r f b src child) 0 none)=some two)
    (nw : NoCoordinatorWrites rows) (snap : r.state.envWorld?=none ∨ r.state.worldMutatedSinceAdoption=true)
    (wf : StorageMap.WF r.state.storage) :
    ∃ next, (Stmt.eval (n+3) model.core.table c r (.block callbackCode)).runWith rows=.ok (.normal next) ∧
      next.locals=r.locals ∧ ∀ g off, Ref.get g next.state off=g.get r.state off := by
  let t := model.core.table
  let base := rootReply c r root one
  let inner := callbackTemps base addr
  have A : Stmt.eval (n+2) t c r.pushScope (.varDecl .address Inv03.Bodies.tmp none)=pure (.normal (getterStart r 0)) := by
    rw [Stmt.eval];dsimp only;rw [Ty.defaultValue];rfl
  have B := serviceFound n t c r root addr rows one field rwrd ar ok1 ans1 decoded
  have C := Inv32Hoist.declEval (n+1) t c (getterStart base addr) viewName .address (.var Inv03.Bodies.tmp) addr
    (Inv32Guards.readWord _ _ _ _ _ rfl) rfl
  have pass (name : String) (a : Inv03.Bodies.tmp≠name) (d : viewName≠name) : inner.lookupLocal? name=r.lookupLocal? name :=
    (lookupOther _ _ _ _ d).trans ((lookupOther _ _ _ _ a).trans (by simp [Runtime.pushScope,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,base,rootReply,replied,Runtime.recordExternalInteraction]))
  have stable (g : Ref) (off : Nat) : g.get inner.state off=g.get r.state off :=
    afterResponse c r one.postWorld (matchedReply _ _ _ _ _ nw ans1) snap wf g off
  have F : f.bound inner "fork" := f.afterDecl (f.afterDecl (f.afterScope fork) _ _ (by decide)) _ _ (by decide)
  have H : b.bound inner "branch" := b.afterDecl (b.afterDecl (b.afterScope branch) _ _ (by decide)) _ _ (by decide)
  let bytes := premiumBytes r f b src child
  have bytesEq : premiumBytes inner f b src child=bytes := by unfold premiumBytes bytes;rw [stable,stable];rfl
  have encoded := calldata c inner 2234981752 (by decide) _ _ (premiumArgumentValues c inner f b src child
    ((pass "source" (by decide) (by decide)).trans source) ((pass "child" (by decide) (by decide)).trans childVal) F H chosen total)
  change premiumData.evalWithRuntimeByContext c inner=.ok (.bytes (premiumBytes inner f b src child),inner) at encoded
  rw [bytesEq] at encoded
  have D := runPremiumCall n t c inner serviceAddress premiumData addr bytes rows two
    (wordFromRead _ _ _ _ (Inv08.localReads _ _ viewName addr rfl))
    (wordFromRead _ _ _ _ (Inv08.Authority.literal _ _ 0 (by decide))) encoded (Nat.mod_eq_of_lt aw) (wireClean _ _) aa code
    (by change rows.answerCall? (snapshotWorld c base.state) _=_;rw [show snapshotWorld c base.state=one.postWorld from secondSnapshot _ _ _ _];exact ans2) ok2
  let next := replied c inner two.postWorld (interaction r f b src child addr two)
  have seq : (Stmt.evalList (n+2) t c r.pushScope callbackCode).runWith rows=.ok (.normal next) := by
    unfold callbackCode
    rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ A,externalSeq _ _ _ _ _ _ _ _ B,
      Inv32FloorStart.seqStep _ _ _ _ _ _ _ C]
    change (Stmt.evalList (n+2) t c inner [premiumCall serviceAddress premiumData]).runWith rows=_
    rw [externalSeq _ _ _ _ _ _ _ _ D,Stmt.evalList];rfl
  refine ⟨next.popScope,?_,rfl,?_⟩
  · rw [Stmt.eval];dsimp only;rw [runWithBind,seq];rfl
  · intro g off
    apply afterResponse c r two.postWorld _ snap wf g off
    exact (matchedReply _ _ _ _ _ nw ans2).trans (matchedReply _ _ _ _ _ nw ans1)
end Inv12
