import Inv40Evaluation
import Inv40Trace

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv40

inductive Getter | forkThreshold | nonDecisionThreshold

def Getter.provider : Getter → String
  | .forkThreshold => "getUniverseTheoreticalSupplyAttoRep"
  | .nonDecisionThreshold => "getForkThresholdAttoRep"

def Getter.slot : Getter → String
  | .forkThreshold => "theoreticalSupplyAttoRep"
  | .nonDecisionThreshold => "forkThresholdAttoRep"

def Getter.key (g : Getter) := "__internal_" ++ g.provider ++ "(uint248)#[SolidCore.Solidity.Ty.uint 248]"
def Getter.target (g : Getter) := "_ret_" ++ g.provider ++ "_0"
def Getter.answer : Getter → Source.Expr
  | .forkThreshold => forkExpr
  | .nonDecisionThreshold => halfExpr

private abbrev uid := "universeId"
private abbrev tmp := "_sol_hoist_0"
private def arg := Source.Expr.castOp .uintCleanup 248 (.var uid)
private def copyValue (g : Getter) := Inv32FloorStart.temp g.slot tmp
private def fetch (g : Getter) := Inv32OneArg.code tmp g.target g.key .uint256 .uint256 arg

def Getter.body (g : Getter) : Source.Stmt :=
  .block [.assign (.var uid) arg,.skip,.block [.varDecl .uint256 tmp none,fetch g,
    copyValue g,.returnValues [g.answer]]]

def entry (r : Runtime) (i : Nat) := r.withFrame [(uid,.word i),("_ret0",.word 0)]
def providerInner (r : Runtime) (i : Nat) := (entry r i).pushScope.pushScope

/-- Supply and fork threshold are obtained from an internal call with the same
universe ID. This is the call instruction, before its result is copied into the
getter's local variable. -/
def providerFrame (g : Getter) (r : Runtime) (i : Nat) := Inv32OneArg.temps (providerInner r i) tmp g.target 0 i 0

def providerReturns (g : Getter) (n : Nat) (t : FunctionTable) (c : Context)
    (r after : Runtime) (i v : Nat) (events : Trace) :=
  let pre := providerFrame g r i
  let post := providerFrame g after i
  ∃ result, internalCallAssign post [g.target] [.word v] = pure result ∧
    Yields (Stmt.eval (n+1) t c pre (.internalCall [g.target] g.key [.var Inv32OneArg.argName])) events result

private theorem cleanId (c : Context) (r : Runtime) (i : Nat) (hi : i<2^248)
    (look : r.lookupLocal? uid = some (.word i)) : Source.Expr.eval c r arg = pure (.word i,r) := by
  have fit : i<R := lt_trans hi (by decide)
  have cast : uintCleanup? c.checked 248 (.word i) = .ok (.word i) := by
    norm_num at hi
    simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,
      show Shared.norm i = i from Nat.mod_eq_of_lt fit, Nat.not_le_of_gt hi,
      Nat.mod_eq_of_lt hi, Bind.bind, Except.bind]
  change Source.Expr.evalFuel (2+1) c r (.castOp .uintCleanup 248 (.var uid)) = _
  rw [Source.Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ look]
  change (do let v ← liftM (uintCleanup? c.checked 248 (.word i)); pure (v,r) : SolI (Value × Runtime)) = _
  rw [cast]; rfl

private theorem returnAnswer (g : Getter) (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (v : Nat) (read : Reads c r g.answer v) :
    Stmt.eval (n+1) t c r (.returnValues [g.answer]) = pure (.returned r [.word v]) := by
  have ret : Source.Expr.evalReturnValue c r g.answer = pure (.word v,r) := by
    cases g <;> exact read _ (by decide)
  have vals : Source.Expr.evalReturnList c r [g.answer] = pure ([.word v],r) := by
    change Source.Expr.evalReturnListFuel (_+1+1) c r [g.answer] = _
    rw [Source.Expr.evalReturnListFuel,ret]; rfl
  rw [Stmt.eval]; dsimp only; rw [vals]; rfl

private def endState (g : Getter) (r : Runtime) (i v : Nat) :=
  ((providerInner r i).declareLocal tmp (.word v)).declareLocal g.slot (.word v)

/-- External view calls can append interactions. Preserve the provider's
post-call runtime when restoring the caller's lexical bindings. -/
private theorem fetchExec (g : Getter) (n : Nat) (t : FunctionTable) (c : Context)
    (r after : Runtime) (i v : Nat) (hi : i<2^248)
    (events : Trace) (provider : providerReturns g n t c r after i v events) :
    Yields (Stmt.eval (n+3) t c ((providerInner r i).declareLocal tmp (.word 0)) (fetch g)) events (.normal ((providerInner after i).declareLocal tmp (.word v))) := by
  let start := (providerInner r i).declareLocal tmp (.word 0)
  let withArg := start.pushScope.declareLocal Inv32OneArg.argName (.word i)
  let ready := providerFrame g after i
  let result := Inv32OneArg.temps (providerInner after i) tmp g.target 0 i v
  let copied := Inv32OneArg.temps (providerInner after i) tmp g.target v i v
  have D := Inv32Hoist.declEval (n+1) t c start.pushScope Inv32OneArg.argName .uint256 arg i
    (cleanId c _ i hi rfl) rfl
  have Z := Inv32FloorStart.zero (n+1) t c withArg g.target
  have assign : ready.assignLocal? g.target (.word v) = some result := by
    cases g <;> simp [ready,result,providerFrame,Inv32OneArg.temps,Inv32OneArg.store,Getter.target,
      Getter.provider,Runtime.assignLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,
      LocalEnv.assign?,Frame.assign?,Value.coerceLike?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,providerInner,entry,Runtime.withFrame]
  obtain ⟨out,assigned,returned⟩ := provider
  have A : internalCallAssign ready [g.target] [.word v] = pure (.normal result) := by
    simp [internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,assign]
  have same : out = .normal result := by rw [A] at assigned; cases assigned; rfl
  subst out
  have captured : Yields (Stmt.eval (n+2) t c (providerFrame g r i)
      (.captureReturn [g.target] (.internalCall [g.target] g.key [.var Inv32OneArg.argName]))) events (.normal result) := by
    rw [Stmt.eval]
    exact finishTrace returned rfl
  have C : Stmt.evalList (n+2) t c result [.assign (.var tmp) (.var g.target)] = pure (.normal copied) := by
    apply Inv32Hoist.lastCopy _ _ _ _ _ _ _ 0 v
    all_goals cases g <;> first | rfl | simp [copied,result,providerInner,entry,Inv32OneArg.temps,
      Inv32OneArg.store,Getter.target,Getter.provider,Runtime.assignLocal?,Runtime.declareLocal,
      Runtime.pushScope,Runtime.withFrame,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,
      Value.coerceLike?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,tmp,Inv32OneArg.argName]
  apply blockTrace (v := .normal copied)
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ D,Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z]
  exact nextTrace captured C

/-- Execute the entire public function body after specifying the answer of its upstream call. -/
theorem Getter.exec (g : Getter) (n : Nat) (t : FunctionTable) (c : Context) (r after : Runtime)
    (i v a : Nat) (hi : i<2^248) (hv : v<R) (events : Trace) (provider : providerReturns g n t c r after i v events)
    (answer : Reads c (endState g after i v) g.answer a) :
    Yields (Stmt.eval (n+5) t c (entry r i) g.body) events (.returned (entry after i) [.word a]) := by
  let pre := providerInner r i
  have upstream := fetchExec g n t c r after i v hi events provider
  have copied := Inv32Temps.temp (n+2) t c ((providerInner after i).declareLocal tmp (.word v)) g.slot tmp v hv rfl
  have result := returnAnswer g (n+2) t c (endState g after i v) a answer
  have suffix := (Inv32FloorStart.seqStep _ _ _ _ _ _ _ copied).trans
    (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ result)
  have middle := nextTrace upstream suffix
  have inside : Yields (Stmt.eval (n+4) t c (entry r i).pushScope
      (.block [.varDecl .uint256 tmp none,fetch g,copyValue g,.returnValues [g.answer]])) events
      (.returned (endState g after i v).popScope [.word a]) := by
    apply blockTrace (v := .returned (endState g after i v) [.word a])
    exact pureHead (Inv32FloorStart.zero (n+2) t c pre tmp) middle
  let outer := (entry r i).pushScope
  have normalize := Inv32Assign.scalarCast (n+3) t c outer outer uid i i .uintCleanup 248 (.var uid)
    rfl (cleanId c outer i hi rfl) (by
      simp [outer,entry,Runtime.withFrame,Runtime.pushScope,Runtime.assignLocal?,Runtime.lookupLocal?,
        LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have skip : Stmt.eval (n+4) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  apply blockTrace (v := .returned (entry after i).pushScope [.word a])
  exact pureHead normalize (pureHead skip (stopTrace inside []))

theorem forkBody (n : Nat) (t : FunctionTable) (c : Context) (r after : Runtime) (i s d : Nat)
    (hi : i<2^248) (hs : s<R) (hd : d<R) (pos : 0<d)
    (events : Trace) (supply : providerReturns .forkThreshold n t c r after i s events)
    (divisor : after.loadImmutableField c "forkThresholdDivisor" = pure (.word d)) :
    Yields (Stmt.eval (n+5) t c (entry r i) Getter.forkThreshold.body) events (.returned (entry after i) [.word (fork s d)]) :=
  Getter.exec _ _ _ _ _ _ _ _ _ hi hs events supply (forkRead _ _ _ _ hs hd pos rfl divisor)

theorem halfBody (n : Nat) (t : FunctionTable) (c : Context) (r after : Runtime) (i v : Nat)
    (hi : i<2^248) (hv : v<R) (events : Trace) (previous : providerReturns .nonDecisionThreshold n t c r after i v events) :
    Yields (Stmt.eval (n+5) t c (entry r i) Getter.nonDecisionThreshold.body) events (.returned (entry after i) [.word (v/2+v%2)]) :=
  Getter.exec _ _ _ _ _ _ _ _ _ hi hv events previous (halfRead _ _ _ hv rfl)

end Inv40
