import Inv48FundingContinuationCapture
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.EscrowPrefix Inv48.QuoteTransport Inv48.RequestDispatch
namespace Inv48.FundingContinuation
set_option autoImplicit false
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

def requestTail : List Stmt :=
  match Inv48.RequestQuote.actual[12]? with
  | some (Stmt.block ss) => ss.drop 2
  | _ => []

def getBlock (entry : Option Stmt) : List Stmt :=
  match entry with
  | some (Stmt.block ss) => ss
  | _ => []

def blockBody := getBlock (Inv48.RequestQuote.actual[12]?)

def entryCall (entry : Option Stmt) : Option Stmt := do
  let Stmt.block ss ← entry | none
  ss[2]?

theorem blockShapeAux (entry : Option Stmt) (call : Stmt)
    (check : entryCall entry = some call) :
    entry = some (.block (getBlock entry)) := by
  cases entry with
  | none => simp only [entryCall] at check; cases check
  | some stmt =>
    cases stmt <;> first | rfl | (simp only [entryCall] at check; cases check)

theorem blockShape : Inv48.RequestQuote.actual[12]? = some (.block blockBody) :=
  blockShapeAux (Inv48.RequestQuote.actual[12]?) Inv48.RequestQuote.callStmt
    Inv48.RequestQuote.checkedCall

theorem dropHead {α : Type} (xs : List α) (n : Nat) (x : α)
    (h : xs[n]? = some x) : xs.drop n = x :: xs.drop (n+1) := by
  induction xs generalizing n with
  | nil => simp at h
  | cons y ys ih =>
    cases n with
    | zero => simp only [List.getElem?_cons_zero,Option.some.injEq] at h; subst y; rfl
    | succ n => simpa using ih n (by simpa using h)

theorem actualDownstream : Inv48.RequestQuote.actual.drop 7 =
    ((Inv48.RequestQuote.actual.drop 7).take 5) ++
      [.block (actualPrep ++ requestTail)] ++ Inv48.RequestQuote.actual.drop 13 := by
  have split := List.take_append_drop 5 (Inv48.RequestQuote.actual.drop 7)
  have head := dropHead Inv48.RequestQuote.actual 12 (.block blockBody) blockShape
  have body : actualPrep ++ requestTail = blockBody := by
    simp only [actualPrep,requestTail,blockShape,List.take_append_drop]
  rw [List.drop_drop] at split
  rw [show 7+5=12 from rfl,head] at split
  simpa [body,List.append_assoc] using split.symm

theorem actualRequestHead : requestTail = Inv48.RequestQuote.callStmt :: requestTail.drop 1 := by
  have call : blockBody[2]? = some Inv48.RequestQuote.callStmt := by
    have checked := Inv48.RequestQuote.checkedCall
    simpa only [Inv48.RequestQuote.actualCall,blockShape] using checked
  have head := dropHead blockBody 2 Inv48.RequestQuote.callStmt call
  simp only [requestTail,blockShape]
  change blockBody.drop 2 = Inv48.RequestQuote.callStmt :: (blockBody.drop 2).drop 1
  simpa [List.drop_drop] using head

/-- The site and request execution are extracted from the real generated
suffix. Every phase belongs to the same transcript; request execution is a
conclusion, not an assumed funding-site execution. -/
theorem actualSite (n : Nat) (c : Context) (start final : Runtime)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList (n+2) Inv48.Source.model.core.table c start
      (Inv48.RequestQuote.actual.drop 7)) trace (.normal final)) :
    ∃ pending site called last outer suffixTrace prepTrace callTrace tailTrace outerTrace,
      trace = suffixTrace ++ prepTrace ++ callTrace ++ tailTrace ++ outerTrace ∧
      ExecutesOK (Stmt.evalList (n+2) Inv48.Source.model.core.table c start
        ((Inv48.RequestQuote.actual.drop 7).take 5)) suffixTrace (.normal pending) ∧
      ExecutesOK (Stmt.evalList (n+1) Inv48.Source.model.core.table c pending.pushScope
        actualPrep) prepTrace (.normal site) ∧
      ExecutesOK (Stmt.eval (n+1) Inv48.Source.model.core.table c site
        Inv48.RequestQuote.callStmt) callTrace (.normal called) ∧
      ExecutesOK (Stmt.evalList (n+1) Inv48.Source.model.core.table c called
        (requestTail.drop 1)) tailTrace (.normal last) ∧
      last.popScope = outer ∧
      ExecutesOK (Stmt.evalList (n+2) Inv48.Source.model.core.table c outer
        (Inv48.RequestQuote.actual.drop 13)) outerTrace (.normal final) := by
  rw [actualDownstream] at run
  obtain ⟨outer,innerTrace,outerTrace,split,innerRun,outerRun⟩ :=
    normalAppend (n+2) Inv48.Source.model.core.table c start final _ _ trace run
  obtain ⟨pending,site,last,st,pt,rt,split2,suffix,prep,rest,scope⟩ :=
    downstream n Inv48.Source.model.core.table c start outer requestTail innerTrace innerRun
  rw [actualRequestHead] at rest
  obtain ⟨called,ct,tt,split3,callRun,tailRun⟩ :=
    normalCons (n+1) Inv48.Source.model.core.table c site last _ _ rt rest
  exact ⟨pending,site,called,last,outer,st,pt,ct,tt,outerTrace,
    by simp [split,split2,split3,List.append_assoc],suffix,prep,callRun,tailRun,scope,outerRun⟩

#print axioms actualDownstream
#print axioms actualRequestHead
#print axioms actualSite
end Inv48.FundingContinuation
