import Inv48SiteEntryBridgePrefix
import Inv48EscrowEntryCore
import Inv48EscrowJoinLocal
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.GuardArgsFrame
open Inv48.RequestPrologue Inv48.EscrowJoin Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def params : List BindingDecl := [⟨"sponsor",.address,false⟩,
  ⟨"proposedRepPerEthPrice",.uint256,false⟩,⟨"requestedInitialAttoWeth",.uint256,false⟩,
  ⟨"bountyAttoEth",.uint256,false⟩,⟨"callbackGasLimit",.uint256,false⟩]
def cleanup : List Stmt := [.skip,
  Inv48.EscrowEntry.cleanup 256 "proposedRepPerEthPrice",
  Inv48.EscrowEntry.cleanup 256 "requestedInitialAttoWeth",
  Inv48.EscrowEntry.cleanup 256 "bountyAttoEth",
  Inv48.EscrowEntry.cleanup 32 "callbackGasLimit",.skip]

def paramsP := seq [
  Inv48.EscrowTrace.bindingPattern (lit "sponsor") Inv48.EscrowTrace.addressPattern (lit false),
  Inv48.EscrowTrace.bindingPattern (lit "proposedRepPerEthPrice") Ty_uint256 (lit false),
  Inv48.EscrowTrace.bindingPattern (lit "requestedInitialAttoWeth") Ty_uint256 (lit false),
  Inv48.EscrowTrace.bindingPattern (lit "bountyAttoEth") Ty_uint256 (lit false),
  Inv48.EscrowTrace.bindingPattern (lit "callbackGasLimit") Ty_uint256 (lit false)]
def cleanupP := seq [Stmt_skip,
  Inv48.RequestPrologue.cleanupP 256 "proposedRepPerEthPrice",
  Inv48.RequestPrologue.cleanupP 256 "requestedInitialAttoWeth",
  Inv48.RequestPrologue.cleanupP 256 "bountyAttoEth",
  Inv48.RequestPrologue.cleanupP 32 "callbackGasLimit",Stmt_skip]
def sourceCheck : Bool :=
  (Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey).any fun fn =>
    paramsP.test fn.params && publicReturnP.test fn.returns &&
    cleanupP.test ((outer fn.body).take 6)

theorem checkedSource : sourceCheck = true := by native_decide

theorem metadata (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn) :
    fn.params = params ∧ fn.returns = [⟨"reportId",.uint256,false⟩] ∧
    (outer fn.body).take 6 = cleanup := by
  have h := checkedSource
  simp only [sourceCheck,registered,Option.any_some,Bool.and_eq_true] at h
  exact ⟨paramsP.sound _ h.1.1,publicReturnP.sound _ h.1.2,cleanupP.sound _ h.2⟩

def args (s p a b g : Nat) : List Value := [.word s,.word p,.word a,.word b,.word g]
def entry (r : Runtime) (s p a b g : Nat) : Runtime :=
  {r with locals := [requestFrame s p a b g]}

theorem initial (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (s p a b g : Nat) :
    fn.initialFrame? (args s p a b g) = some (requestFrame s p a b g) := by
  obtain ⟨ps,rs,_⟩ := metadata fn registered
  simp [InternalFunction.initialFrame?,InternalFunction.returnDefaultBindings,ps,rs,
    params,args,requestFrame,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,
    BindingDecl.bindArg?,BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue]

theorem entered (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (r : Runtime) (s p a b g : Nat) :
    internalCallEnter? fn (args s p a b g) r = some (entry r s p a b g,r.locals) := by
  simp [internalCallEnter?,initial fn registered,entry]

def Lookups (r : Runtime) (p a b : Nat) : Prop :=
  r.lookupLocal? "proposedRepPerEthPrice" = some (.word p) ∧
  r.lookupLocal? "requestedInitialAttoWeth" = some (.word a) ∧
  r.lookupLocal? "bountyAttoEth" = some (.word b)

theorem entryLookups (r : Runtime) (s p a b g : Nat) : Lookups (entry r s p a b g) p a b := by
  simp [Lookups,entry,requestFrame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]

theorem cleanupExecution (n : Nat) (t : FunctionTable) (c : Context) (raw : Runtime)
    (s p a b g : Nat) (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256)
    (hg : g < 2^32) :
    Stmt.evalList (n+1) t c (entry raw s p a b g).pushScope cleanup =
      pure (.normal (entry raw s p a b g).pushScope) := by
  let r := (entry raw s p a b g).pushScope
  have clean (bits v : Nat) (name : String) (positive : 0 < bits) (width : bits ≤ 256)
      (word : v < 2^256) (fits : v < 2^bits)
      (look : r.lookupLocal? name = some (.word v))
      (write : r.assignLocal? name (.word v) = some r) :=
    Inv48.EscrowEntry.cleanupExec n t c r bits v name look
      (Inv48.EscrowEntry.cleanWidth c.checked bits v positive width word fits) write
  have P := clean 256 p "proposedRepPerEthPrice" (by decide) (by decide) hp hp
    (by rfl) (by simp [r,entry,requestFrame,Runtime.pushScope,Runtime.assignLocal?,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?])
  have A := clean 256 a "requestedInitialAttoWeth" (by decide) (by decide) ha ha
    (by rfl) (by simp [r,entry,requestFrame,Runtime.pushScope,Runtime.assignLocal?,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?])
  have B := clean 256 b "bountyAttoEth" (by decide) (by decide) hb hb
    (by rfl) (by simp [r,entry,requestFrame,Runtime.pushScope,Runtime.assignLocal?,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?])
  have G := clean 32 g "callbackGasLimit" (by decide) (by decide) (hg.trans_le (by decide)) hg
    (by rfl) (by simp [r,entry,requestFrame,Runtime.pushScope,Runtime.assignLocal?,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?])
  have skip : Stmt.eval (n+1) t c r .skip = pure (.normal r) := by rw [Stmt.eval]
  change Stmt.evalList (n+1) t c r cleanup = _
  unfold cleanup
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ P,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ A,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ B,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ G,Inv48.WholeQuote.singleList,skip]


/-- Successful executions only; no assumptions on responder answers or state. -/
def StatementFrame (fuel : Nat) (t : FunctionTable) (c : Context) (stmt : Stmt) : Prop :=
  ∀ r final trace, ExecutesOK (Stmt.eval fuel t c r stmt) trace (.normal final) →
    final.locals = r.locals

theorem sequenceFrame (fuel : Nat) (t : FunctionTable) (c : Context) (ss : List Stmt)
    (frames : ∀ stmt ∈ ss, StatementFrame fuel t c stmt)
    (r final : Runtime) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList fuel t c r ss) trace (.normal final)) :
    final.locals = r.locals := by
  induction ss generalizing r trace with
  | nil => rw [Stmt.evalList] at run; have h := pureResult _ _ _ run; cases h.2; rfl
  | cons stmt ss ih =>
    obtain ⟨mid,before,after,_,first,last⟩ := sequenceNormal fuel t c r final stmt ss trace run
    exact (ih (fun st mem => frames st (by simp [mem])) mid after last).trans
      (frames stmt (by simp) r mid before first)

end Inv48.GuardArgsFrame
