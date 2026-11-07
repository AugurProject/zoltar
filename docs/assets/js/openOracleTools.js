// Generated from docs/runtime TypeScript by bun run docs:build-runtime. Do not edit.
// docs/runtime/openOracleTools.ts
function collectElements(root, selector, key, expected) {
  const result = {};
  for (const element of root.querySelectorAll(selector)) {
    if (!(element instanceof expected))
      continue;
    const name = element.dataset[key];
    if (name !== undefined)
      result[name] = element;
  }
  return result;
}
function collectExample(exampleId) {
  const root = document.querySelector(exampleId);
  if (!(root instanceof HTMLElement))
    return;
  const inputs = collectElements(root, "[data-example-input]", "exampleInput", HTMLInputElement);
  const outputs = collectElements(root, "[data-example-output]", "exampleOutput", HTMLOutputElement);
  const values = collectElements(root, "[data-example-value]", "exampleValue", HTMLElement);
  return {
    inputs,
    read: (name) => {
      const value = Number(inputs[name]?.value);
      return Number.isFinite(value) ? value : 0;
    },
    root,
    writeOutput: (name, value) => {
      const output = outputs[name];
      if (output !== undefined)
        output.value = value;
    },
    writeValue: (name, value) => {
      const element = values[name];
      if (element !== undefined)
        element.textContent = value;
    }
  };
}
function bindExample(exampleId, update) {
  const context = collectExample(exampleId);
  if (context === undefined)
    return;
  for (const input of Object.values(context.inputs))
    input.addEventListener("input", () => update(context));
  update(context);
}
function calculateMinimumWethEstimate(parameters) {
  const percentagePrecision = 10000000n;
  const targetErrorUnits = BigInt(Math.round(parameters.targetPriceErrorForDispute * 1e5));
  const feeUnits = BigInt(Math.round((parameters.openOracleProtocolFee + parameters.openOracleReporterFee) * 1e5));
  const targetError = parameters.targetPriceErrorForDispute / 100;
  const feeFraction = (parameters.openOracleProtocolFee + parameters.openOracleReporterFee) / 100;
  const correctionProfitFraction = (targetError - feeFraction) / (1 + targetError);
  const disputeGasCostEth = parameters.gasUnitsForOneDispute * (parameters.blockBaseFeeNanoEth + parameters.initialReportPriorityFeeNanoEth) * 0.000000001;
  const bufferedGasCostEth = disputeGasCostEth * parameters.openOracleSecurityMultiplier;
  const correctionProfitUnits = targetErrorUnits - feeUnits;
  let minimumWethReportAttoEth;
  if (correctionProfitUnits > 0n) {
    const denominator = 10000n * correctionProfitUnits;
    const calculateGasPriceReport = (gasPriceNanoEth) => {
      const numerator = BigInt(Math.round(gasPriceNanoEth * 1e9)) * BigInt(Math.round(parameters.gasUnitsForOneDispute)) * BigInt(Math.round(parameters.openOracleSecurityMultiplier * 1e4)) * (percentagePrecision + targetErrorUnits);
      return (numerator + denominator - 1n) / denominator;
    };
    const priorityFeeReportAttoEth = calculateGasPriceReport(parameters.initialReportPriorityFeeNanoEth);
    const baseFeeReportAttoEth = calculateGasPriceReport(parameters.blockBaseFeeNanoEth);
    const openInterestAttoWeth = BigInt(Math.round(parameters.aggregateExposureEth)) * 10n ** 18n;
    const openInterestReportAttoEth = (openInterestAttoWeth + 99n) / 100n;
    minimumWethReportAttoEth = priorityFeeReportAttoEth + (baseFeeReportAttoEth > openInterestReportAttoEth ? baseFeeReportAttoEth : openInterestReportAttoEth);
  }
  const openInterestAttoWeth = BigInt(Math.round(parameters.aggregateExposureEth)) * 10n ** 18n;
  const openInterestEscalationHaltAttoEth = (openInterestAttoWeth + 99n) / 100n;
  const requestedInitialAttoWeth = BigInt(Math.round(parameters.requestedInitialWeth * 1000000000000000000));
  let selectedInitialWethReportAttoEth;
  if (minimumWethReportAttoEth !== undefined)
    selectedInitialWethReportAttoEth = requestedInitialAttoWeth > minimumWethReportAttoEth ? requestedInitialAttoWeth : minimumWethReportAttoEth;
  const initialReportEscalationHaltAttoEth = selectedInitialWethReportAttoEth === undefined ? undefined : selectedInitialWethReportAttoEth * BigInt(Math.round(parameters.escalationHaltMultiplier * 1e4)) / 10000n;
  let selectedEscalationHaltAttoEth;
  if (initialReportEscalationHaltAttoEth !== undefined)
    selectedEscalationHaltAttoEth = initialReportEscalationHaltAttoEth > openInterestEscalationHaltAttoEth ? initialReportEscalationHaltAttoEth : openInterestEscalationHaltAttoEth;
  return {
    bufferedGasCostEth,
    correctionProfitFraction,
    disputeGasCostEth,
    initialReportEscalationHaltAttoEth,
    minimumWethReportAttoEth,
    openInterestEscalationHaltAttoEth,
    selectedEscalationHaltAttoEth,
    selectedInitialWethReportAttoEth
  };
}
function formatWethFromAttoEth(attoWeth) {
  const atomicWethPerWeth = 10n ** 18n;
  const whole = attoWeth / atomicWethPerWeth;
  const fraction = attoWeth % atomicWethPerWeth;
  return `${whole.toString()}.${fraction.toString().padStart(18, "0")} WETH`;
}
function formatCompactWethFromAttoEth(attoWeth) {
  const displayScale = 10000n;
  const atomicPerDisplayUnit = 10n ** 18n / displayScale;
  const rounded = (attoWeth + atomicPerDisplayUnit / 2n) / atomicPerDisplayUnit;
  const whole = rounded / displayScale;
  const fraction = (rounded % displayScale).toString().padStart(4, "0").replace(/0+$/, "");
  return `${whole}${fraction.length === 0 ? "" : `.${fraction}`} WETH`;
}
function setMeter(context, name, value, maximum) {
  const output = context.root.querySelector(`[data-example-output="${name}"]`);
  const card = output?.parentElement;
  if (card === null || card === undefined)
    return;
  const progress = maximum <= 0 ? 0 : Math.min(1, Math.max(0, value / maximum));
  card.style.setProperty("--widget-meter", `${progress * 100}%`);
  card.dataset["widgetMeter"] = "true";
}
bindExample("#initial-report-estimator-example", (context) => {
  const parameters = {
    blockBaseFeeNanoEth: context.read("blockBaseFeeNanoEth"),
    escalationHaltMultiplier: context.read("escalationHaltMultiplier"),
    gasUnitsForOneDispute: context.read("gasUnitsForOneDispute"),
    initialReportPriorityFeeNanoEth: context.read("initialReportPriorityFeeNanoEth"),
    aggregateExposureEth: context.read("aggregateExposureEth"),
    openOracleProtocolFee: context.read("openOracleProtocolFee"),
    openOracleReporterFee: context.read("openOracleReporterFee"),
    openOracleSecurityMultiplier: context.read("openOracleSecurityMultiplier"),
    requestedInitialWeth: context.read("requestedInitialWeth"),
    targetPriceErrorForDispute: context.read("targetPriceErrorForDispute")
  };
  const estimate = calculateMinimumWethEstimate(parameters);
  context.writeValue("blockBaseFeeNanoEth", `${parameters.blockBaseFeeNanoEth.toFixed(0)} nanoETH`);
  context.writeValue("initialReportPriorityFeeNanoEth", `${parameters.initialReportPriorityFeeNanoEth.toFixed(0)} nanoETH`);
  context.writeValue("aggregateExposureEth", `${parameters.aggregateExposureEth.toFixed(0)} WETH`);
  context.writeValue("gasUnitsForOneDispute", `${parameters.gasUnitsForOneDispute.toLocaleString()} gas`);
  context.writeValue("openOracleSecurityMultiplier", `${parameters.openOracleSecurityMultiplier.toFixed(1)}x`);
  context.writeValue("targetPriceErrorForDispute", `${parameters.targetPriceErrorForDispute.toFixed(1)}%`);
  context.writeValue("openOracleProtocolFee", `${parameters.openOracleProtocolFee.toFixed(1)}%`);
  context.writeValue("openOracleReporterFee", `${parameters.openOracleReporterFee.toFixed(1)}%`);
  context.writeValue("requestedInitialWeth", `${parameters.requestedInitialWeth.toFixed(2)} WETH`);
  context.writeValue("escalationHaltMultiplier", `${parameters.escalationHaltMultiplier.toFixed(0)}x`);
  const unsafeText = "unsafe: fees meet or exceed target error";
  context.writeOutput("initialReportEscalationHalt", estimate.initialReportEscalationHaltAttoEth === undefined ? unsafeText : formatWethFromAttoEth(estimate.initialReportEscalationHaltAttoEth));
  context.writeOutput("openInterestEscalationHalt", formatWethFromAttoEth(estimate.openInterestEscalationHaltAttoEth));
  context.writeOutput("estimatedMinimumWethReport", estimate.minimumWethReportAttoEth === undefined ? unsafeText : formatWethFromAttoEth(estimate.minimumWethReportAttoEth));
  context.writeOutput("selectedInitialWethReport", estimate.selectedInitialWethReportAttoEth === undefined ? unsafeText : formatCompactWethFromAttoEth(estimate.selectedInitialWethReportAttoEth));
  context.writeOutput("selectedEscalationHalt", estimate.selectedEscalationHaltAttoEth === undefined ? unsafeText : formatWethFromAttoEth(estimate.selectedEscalationHaltAttoEth));
  context.writeOutput("disputeGasCost", `${estimate.disputeGasCostEth.toFixed(6)} ETH`);
  context.writeOutput("bufferedGasCost", `${estimate.bufferedGasCostEth.toFixed(6)} ETH`);
  context.writeOutput("correctionProfitFraction", estimate.correctionProfitFraction > 0 ? `${(estimate.correctionProfitFraction * 100).toFixed(4)}%` : "not positive");
  context.writeOutput("estimatorSafetyState", estimate.correctionProfitFraction > 0 ? "fees below target error" : unsafeText);
  context.root.dataset["widgetState"] = estimate.correctionProfitFraction > 0 ? "safe" : "unsafe";
  const meterValues = [
    ["estimatedMinimumWethReport", estimate.minimumWethReportAttoEth],
    ["selectedInitialWethReport", estimate.selectedInitialWethReportAttoEth],
    ["selectedEscalationHalt", estimate.selectedEscalationHaltAttoEth]
  ];
  const maximum = Math.max(...meterValues.map(([, value]) => Number(value ?? 0n)), 1);
  for (const [name, value] of meterValues)
    setMeter(context, name, Number(value ?? 0n), maximum);
});
