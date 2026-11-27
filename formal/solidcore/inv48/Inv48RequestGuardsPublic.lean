import Inv48RequestGuardsSeek
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

def wordBindingP (name : String) (n : Nat) : Pattern (String × Value) where
  value := (name,.word n)
  test | (s,.word v) => s == name && v == n | _ => false
  sound v h := by split at h <;> simp_all

def memoryBindingP (name : String) (n : Nat) : Pattern (String × Value) where
  value := (name,.memoryRef n)
  test | (s,.memoryRef v) => s == name && v == n | _ => false
  sound v h := by split at h <;> simp_all

def savedP (sponsor p a bounty gas old hoisted : Nat) : Pattern LocalEnv :=
  seq [seq [memoryBindingP Inv48.QuoteTransport.ret old,
    wordBindingP "_ic_arg_2" bounty,wordBindingP "_ic_arg_1" a,wordBindingP "_ic_arg_0" p],
    seq [memoryBindingP Inv48.QuoteTransport.hoist hoisted],seq [],
    seq [wordBindingP "sponsor" sponsor,wordBindingP "proposedRepPerEthPrice" p,
      wordBindingP "requestedInitialAttoWeth" a,wordBindingP "bountyAttoEth" bounty,
      wordBindingP "callbackGasLimit" gas,wordBindingP "reportId" 0]]

theorem savedValue (sponsor p a bounty gas old hoisted : Nat) :
    (savedP sponsor p a bounty gas old hoisted).value =
      Inv48.QuoteTransport.saved [] ([]::Inv48.RequestPrologue.requestFrame sponsor p a bounty gas::[])
        p a bounty old hoisted := rfl

theorem publicEntryFor (fuel : Nat) (c : Context) (state : State) (p a bounty : Nat)
    (fn : FunctionDef) (linked : Inv48.RequestPrologue.publicRequest = some fn) :
    fn.evalBodyEntry fuel Inv48.Source.model.core.table c state [.word p,.word a,.word bounty] =
      some (Stmt.eval fuel Inv48.Source.model.core.table c
        (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body) := by
  obtain ⟨actual,found,entry⟩ := Inv48.RequestPrologue.registeredPublicEntry fuel c state p a bounty
  have eq : actual = fn := Option.some.inj (found.symm.trans linked)
  simpa only [eq] using entry

/-- Every value here is recovered from actual public execution. The saved-frame
check is reflected equality, not a supplied local-read or reached-prefix premise. -/
structure PublicQuote (fuel : Nat) (c : Context) (state : State) (p a bounty : Nat) where
  fn : FunctionDef
  linked : Inv48.RequestPrologue.publicRequest = some fn
  cut : Cut fuel Inv48.Source.model.core.table c
    (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body
  gas : Nat
  old : Nat
  hoisted : Nat
  frame : cut.runtime.locals = Inv48.QuoteTransport.saved []
    ([]::Inv48.RequestPrologue.requestFrame c.sender p a bounty gas::[]) p a bounty old hoisted
  site : cut.statement = Inv48.RequestQuote.quoteCaptureP.value
  checked : cut.context.checked = true
  siteFuelBound : 24 ≤ cut.siteFuel
  gasBound : gas < 2^32
  sponsorBound : c.sender < 2^160
  priceBound : p < 2^256
  collateralBound : a < 2^256
  bountyBound : bounty < 2^256

/-- Canonical oracle answers are looked up at their actual snapshots by observe.
No callback gas, sponsor, helper result, trace or target runtime is an input.
Availability remains a bounded computation condition and is not asserted. -/
def publicQuote (fuel budget : Nat) (rows : ScriptedResponder) (c : Context)
    (state : State) (p a bounty : Nat) : Option (PublicQuote fuel c state p a bounty) := do
  match linked : Inv48.RequestPrologue.publicRequest with
  | none => none
  | some fn => do
    let cut ← seek requestPath fuel budget rows Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body
    let some (.word gas) := cut.runtime.lookupLocal? "callbackGasLimit" | none
    let some (.memoryRef old) := cut.runtime.lookupLocal? Inv48.QuoteTransport.ret | none
    let some (.memoryRef hoisted) := cut.runtime.lookupLocal? Inv48.QuoteTransport.hoist | none
    if frame : (savedP c.sender p a bounty gas old hoisted).test cut.runtime.locals = true then
      if site : Inv48.RequestQuote.quoteCaptureP.test cut.statement = true then
        if checked : cut.context.checked = true then
          if hp : p < 2^256 then
            if ha : a < 2^256 then
              if hb : bounty < 2^256 then
                if hg : gas < 2^32 then
                  if hs : c.sender < 2^160 then
                    if hf : 24 ≤ cut.siteFuel then
                      return ⟨fn,linked,cut,gas,old,hoisted,
                        (savedP c.sender p a bounty gas old hoisted).sound _ frame,
                        Inv48.RequestQuote.quoteCaptureP.sound _ site,checked,hf,hg,hs,hp,ha,hb⟩
                    else none
                  else none
                else none
              else none
            else none
          else none
        else none
      else none
    else none

def PublicQuote.raw (q : PublicQuote fuel c state p a bounty) : Runtime :=
  Inv48.RequestPrologue.base q.cut.runtime

def PublicQuote.transportFuel (q : PublicQuote fuel c state p a bounty) : Nat :=
  q.cut.siteFuel-24

theorem PublicQuote.transportFuelExact (q : PublicQuote fuel c state p a bounty) :
    q.transportFuel+24 = q.cut.siteFuel := by
  have bound := q.siteFuelBound
  simp only [PublicQuote.transportFuel]
  omega

theorem PublicQuote.callerRuntime (q : PublicQuote fuel c state p a bounty) :
    q.cut.runtime = Inv48.RequestPrologue.caller q.raw []
      ([]::Inv48.RequestPrologue.requestFrame c.sender p a bounty q.gas::[]) p a bounty q.old q.hoisted := by
  have h := q.frame
  generalize eq : q.cut.runtime = r at h ⊢
  cases r
  simp only at h
  simp only [Inv48.RequestPrologue.caller,PublicQuote.raw,Inv48.RequestPrologue.base,eq,h]

theorem PublicQuote.siteContext (q : PublicQuote fuel c state p a bounty) :
    q.cut.context = {c with checked := true} := by
  simpa only [q.checked] using q.cut.contextOrigin

/-- Actual public entry reaches the exact quote capture, including its complete
public/request continuation. Reference arguments and isolated quote entry are
then derived with the registered metadata, ready for registeredTransport. -/
theorem publicQuoteInputs (q : PublicQuote fuel c state p a bounty)
    (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn) :
    q.fn.evalBodyEntry fuel Inv48.Source.model.core.table c state [.word p,.word a,.word bounty] =
      some (Stmt.eval fuel Inv48.Source.model.core.table c
        (Inv48.RequestPrologue.publicBase c state p a bounty) q.fn.body) ∧
    Prefix (Stmt.eval fuel Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) q.fn.body) q.cut.trace
      (Stmt.eval q.cut.siteFuel Inv48.Source.model.core.table {c with checked := true}
        (Inv48.RequestPrologue.caller q.raw []
          ([]::Inv48.RequestPrologue.requestFrame c.sender p a bounty q.gas::[]) p a bounty q.old q.hoisted)
        Inv48.RequestQuote.quoteCaptureP.value >>= q.cut.continuation) ∧
    Expr.evalRefArgList {c with checked := true} q.cut.runtime
      [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"] =
      pure ([.word p,.word a,.word bounty],q.cut.runtime) ∧
    internalCallEnter? fn [.word p,.word a,.word bounty] q.cut.runtime =
      some (Inv48.WholeQuote.entry q.raw p a bounty,
        Inv48.QuoteTransport.saved []
          ([]::Inv48.RequestPrologue.requestFrame c.sender p a bounty q.gas::[]) p a bounty q.old q.hoisted) := by
  refine ⟨publicEntryFor fuel c state p a bounty q.fn q.linked,?_,?_,?_⟩
  · simpa only [q.site,q.siteContext,q.callerRuntime] using q.cut.reached
  · rw [q.callerRuntime]
    exact Inv48.RequestPrologue.arguments _ q.raw [] _ p a bounty q.old q.hoisted
  · rw [q.callerRuntime]
    have entered := Inv48.RequestPrologue.enter fn q.raw []
      ([]::Inv48.RequestPrologue.requestFrame c.sender p a bounty q.gas::[]) p a bounty q.old q.hoisted
      (Inv48.RequestPrologue.registeredInitial fn linked p a bounty q.priceBound q.collateralBound q.bountyBound)
    simpa only [PublicQuote.raw,Inv48.RequestPrologue.base] using entered

end Inv48.RequestGuards
