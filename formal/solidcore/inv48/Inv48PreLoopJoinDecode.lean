import Inv48PreLoopJoinCertificate
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.PreLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

theorem decodeFour (ty : Ty) (data : List Byte) (values : List Value)
    (decoded : ABI.decodeArgsWith? [(true,.uint256),(true,.uint256),(true,.uint256),(true,ty)] data = .ok values) :
    ∃ p a b rawBatch, values = [.word p,.word a,.word b,rawBatch] ∧
      p < 2^256 ∧ a < 2^256 ∧ b < 2^256 := by
  unfold ABI.decodeArgsWith? at decoded
  cases heads : ABI.Ty.listAbiHeadWords? ([.uint256,.uint256,.uint256,ty]) with
  | none => simp [heads,ABI.abiArgOpt,Bind.bind,Except.bind] at decoded
  | some heads =>
    simp only [List.map_cons,List.map_nil] at decoded
    simp only [heads,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure] at decoded
    split at decoded
    · contradiction
    · have uintHead : ABI.Ty.abiHeadWords? .uint256 = some 1 := rfl
      cases one : ABI.decodeValueAt? true data 0 .uint256 with
      | error err => simp [ABI.decodeArgsAux?,one,Bind.bind,Except.bind] at decoded
      | ok v1 =>
        obtain ⟨p,rfl,hp⟩ := Inv48.SimpleWrapperArgs.decodeUint true data 0 v1 one
        cases two : ABI.decodeValueAt? true data 1 .uint256 with
        | error err => simp only [ABI.decodeArgsAux?,one,uintHead,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure,Nat.reduceAdd,Nat.zero_add,two] at decoded; contradiction
        | ok v2 =>
          obtain ⟨a,rfl,ha⟩ := Inv48.SimpleWrapperArgs.decodeUint true data 1 v2 two
          cases three : ABI.decodeValueAt? true data 2 .uint256 with
          | error err => simp only [ABI.decodeArgsAux?,one,uintHead,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure,Nat.reduceAdd,Nat.zero_add,two,three] at decoded; contradiction
          | ok v3 =>
            obtain ⟨b,rfl,hb⟩ := Inv48.SimpleWrapperArgs.decodeUint true data 2 v3 three
            cases four : ABI.decodeValueAt? true data 3 ty with
            | error err => simp only [ABI.decodeArgsAux?,one,uintHead,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure,Nat.reduceAdd,Nat.zero_add,two,three,four] at decoded; contradiction
            | ok rawBatch =>
              cases head : ABI.Ty.abiHeadWords? ty with
              | none => simp only [ABI.decodeArgsAux?,one,uintHead,head,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure,Nat.reduceAdd,Nat.zero_add,two,three,four] at decoded; contradiction
              | some size =>
                simp only [ABI.decodeArgsAux?,one,uintHead,head,ABI.abiArgOpt,Bind.bind,Except.bind,Pure.pure,Except.pure,Nat.reduceAdd,Nat.zero_add,two,three,four,Except.ok.injEq] at decoded
                exact ⟨p,a,b,rawBatch,decoded.symm,hp,ha,hb⟩

/-- Decode only the scalar prefix. The fourth decoder is lazy; its result is
passed through the actual lazy parameter cleanup without enumerating elements. -/
theorem decodedWords (fn : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some fn)
    (data : List Byte) (values : List Value)
    (decoded : ABI.decodeFunctionArgs? fn data = .ok values) :
    ∃ p a b rawBatch, values = [.word p,.word a,.word b,rawBatch] ∧
      p < 2^256 ∧ a < 2^256 ∧ b < 2^256 := by
  have md :=  checkedDecodeMetadata
  simp only [decodeMetadataCheck,found,Option.any_some,Bool.and_eq_true,beq_iff_eq] at md
  have pref :=  Inv48.SimpleWrapperArgs.abiCleanupsP.sound _ md.1.1
  have shape : fn.paramAbiCleanups = [.uint 256,.uint 256,.uint 256,batchCleanup fn] := by
    have split := (List.take_append_drop 3 fn.paramAbiCleanups).symm
    rw [pref] at split
    cases tail : fn.paramAbiCleanups.drop 3 with
    | nil => simp [tail] at md
    | cons c cs =>
      cases cs with
      | cons d ds => simp [tail] at md
      | nil =>
        have full : fn.paramAbiCleanups = [.uint 256,.uint 256,.uint 256,c] := by
          simpa [Inv48.SimpleWrapperArgs.abiCleanupsP,Inv48.SimpleWrapperArgs.uintCleanupP,tail] using split
        have eq : batchCleanup fn = c := by unfold batchCleanup; rw [full]; rfl
        simpa only [eq] using full
  obtain ⟨params,_⟩ := Inv48.BatchLoopClosure.actualParameters fn found
  have deq : ABI.decodeFunctionArgs? fn data = (do
      let vs ← ABI.decodeArgsWith? [(true,.uint256),(true,.uint256),(true,.uint256),
        (true,(Inv48.BatchLoopClosure.batchDecl fn).ty)] data
      ABI.abiArgOpt (AbiCleanups.lazyParamValues [.uint 256,.uint 256,.uint 256,batchCleanup fn] vs)) := by
    simp only [ABI.decodeFunctionArgs?,params,shape,Inv48.WrapperArgs.params,
      List.cons_append,List.nil_append,List.map_cons,List.map_nil,List.length_cons,List.length_nil,
      show ABI.AbiCleanup.decodeLazy (.uint 256) = true from rfl,md.2]
    rfl
  rw [deq] at decoded
  cases args : ABI.decodeArgsWith? [(true,.uint256),(true,.uint256),(true,.uint256),
      (true,(Inv48.BatchLoopClosure.batchDecl fn).ty)] data with
  | error err => simp [args,Bind.bind,Except.bind] at decoded
  | ok vs =>
    obtain ⟨p,a,b,raw,rfl,hp,ha,hb⟩ := decodeFour _ data vs args
    have pn : SolidCore.Solidity.Shared.norm p = p := Nat.mod_eq_of_lt hp
    have an : SolidCore.Solidity.Shared.norm a = a := Nat.mod_eq_of_lt ha
    have bn : SolidCore.Solidity.Shared.norm b = b := Nat.mod_eq_of_lt hb
    simp only [args,Bind.bind,Except.bind] at decoded
    have cp : (AbiCleanup.uint 256).accepts (.word p) = true := by simpa [AbiCleanup.accepts,pn] using hp
    have ca : (AbiCleanup.uint 256).accepts (.word a) = true := by simpa [AbiCleanup.accepts,an] using ha
    have cb : (AbiCleanup.uint 256).accepts (.word b) = true := by simpa [AbiCleanup.accepts,bn] using hb
    have pp : (AbiCleanup.uint 256).lazyParamValue (.word p) = some (.word p) := by simp [AbiCleanup.lazyParamValue,cp]
    have aa : (AbiCleanup.uint 256).lazyParamValue (.word a) = some (.word a) := by simp [AbiCleanup.lazyParamValue,ca]
    have bb : (AbiCleanup.uint 256).lazyParamValue (.word b) = some (.word b) := by simp [AbiCleanup.lazyParamValue,cb]
    simp only [AbiCleanups.lazyParamValues,pp,aa,bb,Option.bind_some] at decoded
    cases clean : (batchCleanup fn).lazyParamValue raw with
    | none => simp [clean,ABI.abiArgOpt,Option.bind] at decoded
    | some rawBatch =>
      simp [clean,ABI.abiArgOpt,Option.bind] at decoded
      exact ⟨p,a,b,rawBatch,decoded.symm,hp,ha,hb⟩
end Inv48.PreLoopJoin
