import Inv48MinimumOperandTransportFinish
import Inv48SimpleWrapperArgsDecode
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumOperandTransport
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

theorem decodeOne (lazy : Bool) (data : List SolidCore.Solidity.Byte) (values : List Value)
    (decoded : ABI.decodeArgsWith? [(lazy,.uint256)] data = .ok values) :
    ∃ q, values = [.word q] ∧ q < Inv32Division.R := by
  simp only [ABI.decodeArgsWith?,List.map_cons,List.map_nil,ABI.Ty.listAbiHeadWords?,
    ABI.Ty.abiHeadWords?,ABI.Ty.isDynamicAbi,ABI.Ty.staticAbiHeadWords?,ABI.abiArgOpt,
    Bind.bind,Except.bind,Pure.pure,Except.pure] at decoded
  by_cases short : data.length < 32
  · simp [ABI.wordBytes,short] at decoded
  · simp only [ABI.wordBytes,Nat.mul_one,short,if_false] at decoded
    cases one : ABI.decodeValueAt? lazy data 0 .uint256 with
    | error e => simp [short,ABI.decodeArgsAux?,one,Bind.bind,Except.bind] at decoded
    | ok v =>
      obtain ⟨q,rfl,fit⟩ := Inv48.SimpleWrapperArgs.decodeUint lazy data 0 v one
      refine ⟨q,?_,fit⟩
      simpa [short,ABI.decodeArgsAux?,one,ABI.Ty.abiHeadWords?,ABI.Ty.isDynamicAbi,
        ABI.Ty.staticAbiHeadWords?,ABI.abiArgOpt,Bind.bind,Except.bind] using decoded.symm

theorem cleanupWord (cleanup : AbiCleanup) (q p : Nat)
    (h : AbiCleanups.lazyParamValues [cleanup] [.word q] = some [.word p]) : p = q := by
  cases cleanup <;>
    simp [AbiCleanups.lazyParamValues,AbiCleanup.lazyParamValue] at h
  all_goals first | exact h.symm | (split at h <;> simp_all)

theorem priceBound (data : List SolidCore.Solidity.Byte) (p : Nat)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry data = .ok [.word p]) :
    p < Inv32Division.R := by
  have params := Inv48.PositiveABI.metadata.2.2.2.1
  unfold ABI.decodeFunctionArgs? at decoded
  rw [params] at decoded
  cases cleanups : Inv48.PositiveABI.entry.paramAbiCleanups with
  | nil =>
    simp only [cleanups,List.length_nil,List.map_cons,List.map_nil,List.length_cons,
      Nat.zero_add,reduceCtorEq,if_false,List.zip_cons_cons,List.zip_nil_left,List.isEmpty_nil,
      if_true] at decoded
    have raw : ABI.decodeArgsWith? [(true,.uint256)] data = .ok [.word p] := by
      cases h : ABI.decodeArgsWith? [(true,.uint256)] data <;> simp_all [Bind.bind,Except.bind]
    obtain ⟨q,values,fit⟩ := decodeOne true data [.word p] raw
    cases values
    exact fit
  | cons cleanup cs =>
    cases cs with
    | nil =>
      simp only [cleanups,List.length_cons,List.length_nil,Nat.zero_add,List.map_cons,List.map_nil,
        beq_self_eq_true,if_true,List.zip_cons_cons,List.zip_nil_left,List.isEmpty_cons,if_false] at decoded
      cases args : ABI.decodeArgsWith? [(ABI.AbiCleanup.decodeLazy cleanup,.uint256)] data with
      | error e => simp [args,Bind.bind,Except.bind] at decoded
      | ok vs =>
        obtain ⟨q,rfl,fit⟩ := decodeOne (ABI.AbiCleanup.decodeLazy cleanup) data vs args
        simp only [args,pure_bind] at decoded
        have clean : AbiCleanups.lazyParamValues [cleanup] [.word q] = some [.word p] := by
          simp only [Bind.bind,Except.bind,ABI.abiArgOpt] at decoded
          cases h : AbiCleanups.lazyParamValues [cleanup] [.word q] <;> simp_all
        rw [cleanupWord cleanup q p clean]
        exact fit
    | cons another rest =>
      simp only [cleanups,List.length_cons,List.length_nil,Nat.zero_add,List.map_cons,List.map_nil,
        List.isEmpty_cons,if_false] at decoded
      have ne : (rest.length + 1 + 1 == 1) = false := by simp
      simp only [ne,Bool.false_eq_true,if_false,List.zip_cons_cons,List.zip_nil_left] at decoded
      cases args : ABI.decodeArgsWith? [(true,.uint256)] data with
      | error e => simp [args,Bind.bind,Except.bind] at decoded
      | ok vs =>
        obtain ⟨q,rfl,fit⟩ := decodeOne true data vs args
        simp [args,AbiCleanups.lazyParamValues,ABI.abiArgOpt,Bind.bind,Except.bind] at decoded

#print axioms decodeOne
#print axioms cleanupWord
#print axioms priceBound
end Inv48.MinimumOperandTransport
