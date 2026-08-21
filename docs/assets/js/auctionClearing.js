// Generated from docs/runtime TypeScript by bun run docs:build-runtime. Do not edit.
(() => {
  // shared/ts/escalationMath.ts
  var ESCALATION_TIME_LENGTH = 4233600n;

  // docs/charts/chartModels.ts
  function calculateAuctionModel(ethRaiseCap, repInventory, bids) {
    const qualificationPrice = ethRaiseCap / repInventory;
    const submittedBids = bids.filter((bid) => bid.eth > 0);
    const activeBids = submittedBids.filter((bid) => bid.price >= qualificationPrice).sort((left, right) => right.price - left.price);
    const ticks = Array.from(new Set(activeBids.map((bid) => bid.price))).map((price) => ({
      bids: activeBids.filter((bid) => bid.price === price),
      price,
      totalEth: activeBids.filter((bid) => bid.price === price).reduce((sum, bid) => sum + bid.eth, 0)
    }));
    let accumulatedBidEth = 0;
    let clearingPrice = 0;
    let ethFilledAtClearing = 0;
    let funded = false;
    let lastValidPrice = 0;
    let lastValidEthAtTick = 0;
    const demandPoints = [];
    const chartRepByKey = new Map;
    for (const tick of ticks) {
      if (accumulatedBidEth > 0 && accumulatedBidEth / tick.price > repInventory) {
        funded = true;
        clearingPrice = lastValidPrice;
        ethFilledAtClearing = lastValidEthAtTick;
        break;
      }
      const ethToTake = Math.min(tick.totalEth, Math.max(0, ethRaiseCap - accumulatedBidEth));
      const newAccumulatedEth = accumulatedBidEth + ethToTake;
      const candidateRep = newAccumulatedEth / tick.price;
      demandPoints.push({ cumulativeRep: candidateRep, price: tick.price });
      for (const bid of tick.bids) {
        chartRepByKey.set(bid.key, candidateRep);
      }
      if (candidateRep >= repInventory) {
        funded = true;
        clearingPrice = tick.price;
        ethFilledAtClearing = Math.max(0, Math.min(ethToTake, repInventory * tick.price - accumulatedBidEth));
        accumulatedBidEth += ethFilledAtClearing;
        break;
      }
      if (newAccumulatedEth >= ethRaiseCap) {
        funded = true;
        clearingPrice = tick.price;
        ethFilledAtClearing = ethToTake;
        accumulatedBidEth = newAccumulatedEth;
        break;
      }
      accumulatedBidEth = newAccumulatedEth;
      lastValidPrice = tick.price;
      lastValidEthAtTick = ethToTake;
    }
    const repByKey = new Map;
    let effectivePrice = clearingPrice;
    if (funded && clearingPrice > 0) {
      let clearingTickEthRemaining = ethFilledAtClearing;
      for (const bid of activeBids) {
        if (bid.price > clearingPrice) {
          repByKey.set(bid.key, bid.eth / clearingPrice);
        } else if (bid.price === clearingPrice) {
          const fillEth = Math.min(bid.eth, clearingTickEthRemaining);
          clearingTickEthRemaining -= fillEth;
          repByKey.set(bid.key, fillEth / clearingPrice);
        }
      }
    } else {
      const winningEthAmount = activeBids.reduce((sum, bid) => sum + bid.eth, 0);
      accumulatedBidEth = winningEthAmount;
      if (winningEthAmount > 0) {
        for (const bid of activeBids) {
          repByKey.set(bid.key, bid.eth * repInventory / winningEthAmount);
        }
      }
      clearingPrice = qualificationPrice;
      effectivePrice = winningEthAmount > 0 ? winningEthAmount / repInventory : 0;
    }
    const results = bids.map((bid) => {
      const rep = repByKey.get(bid.key) ?? 0;
      let status = "Rejected";
      if (rep > 0) {
        const fullRepAtClearing = bid.eth / effectivePrice;
        status = funded && rep + 0.000000001 < fullRepAtClearing ? "Partially filled" : "Accepted";
      }
      return { ...bid, chartRep: chartRepByKey.get(bid.key) ?? bid.eth / Math.max(bid.price, Number.EPSILON), rep, status };
    });
    return {
      bids: results,
      clearingPrice,
      demandPoints,
      effectivePrice,
      ethRaised: accumulatedBidEth,
      mode: funded ? "uniform" : "underfunded",
      qualificationPrice
    };
  }
  var ESCALATION_TIME_LENGTH_DAYS = Number.parseInt(ESCALATION_TIME_LENGTH.toString(), 10) / 86400;
  var ATTO_REP = 10n ** 18n;

  // docs/runtime/auctionClearing.ts
  function formatFixed(value, digits = 2) {
    if (!Number.isFinite(value))
      return "not available";
    return value.toFixed(digits).replace(/\.?0+$/, "");
  }
  function formatEth(value) {
    return `${formatFixed(value)} ETH`;
  }
  function formatRep(value) {
    return `${formatFixed(value)} REP`;
  }
  var auctionExample = document.querySelector("#simple-auction-example");
  if (auctionExample instanceof HTMLElement) {
    const inputs = {};
    const outputs = {};
    const values = {};
    for (const input of auctionExample.querySelectorAll("[data-example-input]")) {
      if (input instanceof HTMLInputElement && input.dataset["exampleInput"] !== undefined)
        inputs[input.dataset["exampleInput"]] = input;
    }
    for (const output of auctionExample.querySelectorAll("[data-example-output]")) {
      if (output instanceof HTMLOutputElement && output.dataset["exampleOutput"] !== undefined)
        outputs[output.dataset["exampleOutput"]] = output;
    }
    for (const value of auctionExample.querySelectorAll("[data-example-value]")) {
      if (value instanceof HTMLElement && value.dataset["exampleValue"] !== undefined)
        values[value.dataset["exampleValue"]] = value;
    }
    const read = (name) => {
      const value = Number(inputs[name]?.value);
      return Number.isFinite(value) ? value : 0;
    };
    const write = (name, value) => {
      const output = outputs[name];
      if (output !== undefined)
        output.value = value;
    };
    const writeValue = (name, value) => {
      const element = values[name];
      if (element !== undefined)
        element.textContent = value;
    };
    const update = () => {
      const ethRaiseCap = read("ethRaiseCap");
      const repInventory = Math.max(read("repInventory"), 1);
      const bids = [
        { eth: read("aliceEth"), key: "alice", name: "Alice", price: 5 },
        { eth: read("bobEth"), key: "bob", name: "Bob", price: 4 },
        { eth: read("carolEth"), key: "carol", name: "Carol", price: 3 }
      ];
      const model = calculateAuctionModel(ethRaiseCap, repInventory, bids);
      writeValue("ethRaiseCap", formatEth(ethRaiseCap));
      writeValue("repInventory", formatRep(repInventory));
      for (const bid of bids)
        writeValue(`${bid.key}Eth`, formatEth(bid.eth));
      const repResults = Object.fromEntries(model.bids.map((bid) => [bid.key, bid.rep]));
      const repSold = model.bids.reduce((sum, bid) => sum + bid.rep, 0);
      if (model.mode === "uniform") {
        const hitEthCap = Math.abs(model.ethRaised - ethRaiseCap) < 0.000000001;
        const hitRepCap = Math.abs(repSold - repInventory) < 0.000000001;
        let bindingCondition = "REP cap";
        if (hitEthCap && hitRepCap)
          bindingCondition = "both caps";
        else if (hitEthCap)
          bindingCondition = "ETH cap";
        write("clearingMode", `uniform clearing near ${formatFixed(model.clearingPrice)} ETH/REP`);
        write("bindingCondition", bindingCondition);
        write("thresholdInputEth", "not underfunded");
        write("underfundedThreshold", "not underfunded");
        auctionExample.dataset["widgetState"] = "safe";
      } else {
        write("clearingMode", "underfunded qualification clearing");
        write("bindingCondition", "underfunded");
        write("thresholdInputEth", formatEth(model.ethRaised));
        write("underfundedThreshold", `${formatFixed(model.qualificationPrice)} ETH/REP`);
        auctionExample.dataset["widgetState"] = model.ethRaised > 0 ? "warning" : "unsafe";
      }
      write("ethRaised", formatEth(model.ethRaised));
      for (const bid of bids) {
        const outputName = `${bid.key}Receives`;
        const allocation = repResults[bid.key] ?? 0;
        write(outputName, formatRep(allocation));
        const card = outputs[outputName]?.parentElement;
        if (card !== null && card !== undefined) {
          card.dataset["widgetMeter"] = "true";
          card.style.setProperty("--widget-meter", `${Math.min(100, Math.max(0, allocation / repInventory * 100))}%`);
        }
      }
      write("totalRepAllocated", formatRep(repSold));
      write("refunds", formatEth(bids.reduce((sum, bid) => sum + bid.eth, 0) - model.ethRaised));
    };
    for (const input of Object.values(inputs))
      input?.addEventListener("input", update);
    update();
  }
})();
