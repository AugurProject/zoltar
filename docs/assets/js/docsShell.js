// Generated from docs/runtime TypeScript by bun run docs:build-runtime. Do not edit.
// docs/runtime/docsSectionIndex.ts
function docsSectionPages(data, sectionId) {
  return data.pages.filter((page) => page.section === sectionId);
}
function docsTopicGroups(data, sectionId) {
  const topics = new Map;
  for (const page of docsSectionPages(data, sectionId)) {
    const pages = topics.get(page.topic) ?? [];
    pages.push(page);
    topics.set(page.topic, pages);
  }
  return topics;
}
function docsIndexElement(name, className, text) {
  const node = document.createElement(name);
  if (className !== "")
    node.className = className;
  if (text !== undefined)
    node.textContent = text;
  return node;
}
function appendLandingSectionIndexes(data, pageUrl) {
  for (const section of data.sections) {
    const container = document.getElementById(section.id);
    const pages = docsSectionPages(data, section.id);
    if (container === null || container.tagName !== "SECTION" || pages.length === 0)
      continue;
    const index = docsIndexElement("details", "docs-section-index");
    index.open = location.hash === `#${section.id}`;
    index.append(docsIndexElement("summary", "", `All ${pages.length} pages in ${section.title}`));
    for (const [topic, topicPages] of docsTopicGroups(data, section.id)) {
      const list = docsIndexElement("ul", "docs-section-index-list");
      for (const page of topicPages) {
        const link = docsIndexElement("a", "", page.title);
        link.href = pageUrl(page.path);
        const item = docsIndexElement("li", "");
        item.append(link);
        list.append(item);
      }
      index.append(docsIndexElement("p", "docs-section-index-topic", topic), list);
    }
    container.append(index);
  }
}

// docs/runtime/docsShell.ts
(() => {
  const isRecord = (value) => typeof value === "object" && value !== null;
  const isString = (value) => typeof value === "string";
  const isSection = (value) => isRecord(value) && isString(value["id"]) && isString(value["title"]);
  const isPage = (value) => isRecord(value) && isString(value["path"]) && isString(value["section"]) && isString(value["topic"]) && isString(value["title"]) && isString(value["summary"]);
  const isDocumentationData = (value) => isRecord(value) && Array.isArray(value["sections"]) && value["sections"].every(isSection) && Array.isArray(value["pages"]) && value["pages"].every(isPage);
  const isSearchEntry = (value) => isRecord(value) && isString(value["fragment"]) && isString(value["heading"]) && Array.isArray(value["keywords"]) && value["keywords"].every(isString) && isString(value["path"]) && isString(value["sectionTitle"]) && isString(value["summary"]) && isString(value["text"]) && isString(value["title"]) && isString(value["topic"]) && typeof value["weight"] === "number";
  const isSearchIndex = (value) => Array.isArray(value) && value.every(isSearchEntry);
  const themeStorageKey = "augur-docs.theme";
  const themeOptions = [
    { label: "System", value: "system" },
    { label: "Light", value: "light" },
    { label: "Dark", value: "dark" }
  ];
  const darkSchemeQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;
  function parseThemePreference(value) {
    return themeOptions.find((option) => option.value === value)?.value ?? "system";
  }
  function readThemePreference() {
    try {
      return parseThemePreference(window.localStorage.getItem(themeStorageKey));
    } catch (error) {
      if (!(error instanceof DOMException))
        throw error;
      return "system";
    }
  }
  function saveThemePreference(preference) {
    try {
      if (preference === "system")
        window.localStorage.removeItem(themeStorageKey);
      else
        window.localStorage.setItem(themeStorageKey, preference);
    } catch (error) {
      if (!(error instanceof DOMException))
        throw error;
    }
  }
  function applyThemePreference(preference) {
    const dark = preference === "dark" || preference === "system" && darkSchemeQuery?.matches === true;
    document.documentElement.dataset["docsTheme"] = dark ? "dark" : "light";
  }
  let themePreference = readThemePreference();
  applyThemePreference(themePreference);
  darkSchemeQuery?.addEventListener("change", () => applyThemePreference(themePreference));
  const rawData = window.statoblastDocs;
  if (!isDocumentationData(rawData))
    return;
  const data = rawData;
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement))
    return;
  const docsRoot = new URL("../../", script.src);
  const relativePath = decodeURIComponent(location.pathname.slice(docsRoot.pathname.length)) || "documentation.html";
  const currentPage = data.pages.find((page) => page.path === relativePath);
  const currentSection = data.sections.find((section) => section.id === currentPage?.section);
  const main = document.querySelector("main");
  if (!(main instanceof HTMLElement))
    return;
  const requiredMain = main;
  const favicon = document.createElement("link");
  favicon.rel = "icon";
  favicon.href = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#176653"/><text x="16" y="22" fill="white" font-family="Georgia,serif" font-size="20" text-anchor="middle">A</text></svg>')}`;
  document.head.append(favicon);
  document.body.classList.add("docs-shell-page");
  if (currentPage === undefined)
    document.body.classList.add("docs-landing-page");
  main.id = main.id || "main-content";
  main.tabIndex = -1;
  function docsUrl(path, fragment = "") {
    const url = new URL(path, docsRoot);
    url.hash = fragment;
    return url.href;
  }
  function element(name, className, text) {
    const node = document.createElement(name);
    if (className.length > 0)
      node.className = className;
    if (text !== undefined)
      node.textContent = text;
    return node;
  }
  function appendBreakableTitle(target, title) {
    const parts = title.split(/(?<=[a-z0-9])(?=[A-Z])/);
    parts.forEach((part, index) => {
      if (index > 0)
        target.append(document.createElement("wbr"));
      target.append(document.createTextNode(part));
    });
  }
  if (currentPage === undefined)
    appendLandingSectionIndexes(data, (path) => docsUrl(path));
  const pageHeading = main.querySelector("h1");
  const pageHeadingText = pageHeading?.textContent?.trim() ?? "";
  if (pageHeading !== null && pageHeading.childElementCount === 0 && /^[A-Za-z0-9]+$/.test(pageHeadingText)) {
    pageHeading.replaceChildren();
    appendBreakableTitle(pageHeading, pageHeadingText);
  }
  const skipLink = element("a", "docs-skip-link", "Skip to documentation");
  skipLink.href = `#${main.id}`;
  const topbar = element("header", "docs-topbar");
  const brand = element("a", "docs-brand");
  brand.href = docsUrl("documentation.html");
  const brandMark = element("span", "docs-brand-mark", "A");
  brandMark.setAttribute("aria-hidden", "true");
  brand.append(brandMark, element("span", "docs-brand-name", "Augur documentation"));
  const actions = element("div", "docs-top-actions");
  const menuButton = element("button", "docs-icon-button", "☰");
  menuButton.type = "button";
  menuButton.setAttribute("aria-label", "Open documentation menu");
  menuButton.setAttribute("aria-expanded", "false");
  const searchButton = element("button", "docs-search-button");
  searchButton.type = "button";
  searchButton.setAttribute("aria-label", "Search documentation");
  searchButton.append(element("span", "", "Search"), element("span", "docs-search-icon", "⌕"), element("kbd", "", "Ctrl/⌘ K"));
  const themeControl = element("div", "docs-theme-control");
  const themeLabel = element("label", "docs-theme-label", "Theme");
  themeLabel.htmlFor = "docs-theme-select";
  const themeSelect = element("select", "docs-theme-select");
  themeSelect.id = "docs-theme-select";
  for (const option of themeOptions) {
    const optionElement = element("option", "", option.label);
    optionElement.value = option.value;
    themeSelect.append(optionElement);
  }
  themeSelect.value = themePreference;
  themeSelect.addEventListener("change", () => {
    themePreference = parseThemePreference(themeSelect.value);
    saveThemePreference(themePreference);
    applyThemePreference(themePreference);
  });
  themeControl.append(themeLabel, themeSelect);
  actions.append(menuButton, searchButton, themeControl);
  topbar.append(brand, actions);
  const left = element("aside", "docs-left");
  left.setAttribute("aria-label", "Documentation navigation");
  left.append(element("p", "docs-navigation-title", "Documentation"));
  const navigation = element("nav", "docs-navigation");
  let currentNavigationLink;
  for (const section of data.sections) {
    if (docsSectionPages(data, section.id).length === 0)
      continue;
    const sectionDetails = element("details", "docs-navigation-section");
    sectionDetails.open = currentPage?.section === section.id;
    sectionDetails.append(element("summary", "", section.title));
    for (const [topic, pages] of docsTopicGroups(data, section.id)) {
      const topicDetails = element("details", "docs-navigation-topic");
      topicDetails.open = pages.some((page) => page.path === currentPage?.path);
      topicDetails.append(element("summary", "", topic));
      const list = element("ul", "docs-navigation-list");
      for (const page of pages) {
        const item = element("li", "");
        const link = element("a", "");
        appendBreakableTitle(link, page.title);
        link.href = docsUrl(page.path);
        if (page.path === currentPage?.path) {
          link.setAttribute("aria-current", "page");
          currentNavigationLink = link;
        }
        item.append(link);
        list.append(item);
      }
      topicDetails.append(list);
      sectionDetails.append(topicDetails);
    }
    navigation.append(sectionDetails);
  }
  left.append(navigation);
  const right = element("aside", "docs-right");
  right.setAttribute("aria-label", "On this page");
  right.append(element("p", "docs-outline-title", "On this page"));
  const outline = element("ol", "docs-outline-list");
  const outlineLinks = new Map;
  for (const heading of main.querySelectorAll("h2[id], h3[id], section[id] > h2:first-child, section[id] > .section-heading > h2:first-child")) {
    const id = heading.id || heading.closest("[id]")?.id;
    if (id === undefined || id.length === 0 || outlineLinks.has(id))
      continue;
    const item = element("li", heading.matches("h3") ? "docs-outline-h3" : "");
    const link = element("a", "", heading.textContent?.replace(/\s+/g, " ").trim() ?? id);
    link.href = `#${encodeURIComponent(id)}`;
    item.append(link);
    outline.append(item);
    outlineLinks.set(id, link);
  }
  if (currentPage === undefined || outline.childElementCount === 0)
    right.hidden = true;
  right.append(outline);
  const mobileOutline = element("details", "docs-mobile-outline");
  mobileOutline.append(element("summary", "", "On this page"), outline.cloneNode(true));
  if (currentPage !== undefined && currentSection !== undefined) {
    const context = element("div", "docs-page-context");
    const breadcrumbs = element("nav", "docs-breadcrumbs");
    breadcrumbs.setAttribute("aria-label", "Breadcrumb");
    const home = element("a", "", "Docs");
    home.href = docsUrl("documentation.html");
    const sectionCrumb = element("a", "", currentSection.title);
    sectionCrumb.href = docsUrl("documentation.html", currentSection.id);
    breadcrumbs.append(home, document.createTextNode("/"), sectionCrumb);
    context.append(breadcrumbs, element("span", "docs-type-badge", currentSection.title), element("p", "docs-page-summary", currentPage.summary));
    main.prepend(context);
    if (!right.hidden)
      context.after(mobileOutline);
    const readingOrder = data.sections.flatMap((section) => Array.from(docsTopicGroups(data, section.id).values()).flat());
    const index = readingOrder.findIndex((page) => page.path === currentPage.path);
    const pager = element("nav", "docs-page-pager");
    pager.setAttribute("aria-label", "Adjacent documentation");
    const adjacentPages = [
      ["Previous", readingOrder[index - 1]],
      ["Next", readingOrder[index + 1]]
    ];
    for (const [label, page] of adjacentPages) {
      if (page === undefined) {
        pager.append(element("span", ""));
        continue;
      }
      const link = element("a", "");
      link.href = docsUrl(page.path);
      const targetSection = page.section === currentPage.section ? undefined : data.sections.find((section) => section.id === page.section);
      link.append(element("span", "", targetSection === undefined ? label : `${label} · ${targetSection.title}`), document.createTextNode(page.title));
      pager.append(link);
    }
    main.append(pager);
  }
  const layout = element("div", "docs-layout");
  main.before(layout);
  layout.append(left, main, right);
  const backdrop = element("button", "docs-navigation-backdrop");
  backdrop.type = "button";
  backdrop.tabIndex = -1;
  backdrop.setAttribute("aria-label", "Close documentation menu");
  document.body.prepend(skipLink, topbar);
  document.body.append(backdrop);
  function isMobileNavigation() {
    return window.innerWidth <= 820;
  }
  function navigationNodeVisible(node) {
    for (let ancestor = node.parentElement;ancestor !== null && ancestor !== left; ancestor = ancestor.parentElement) {
      if (ancestor.matches("details:not([open])") && ancestor.firstElementChild !== node)
        return false;
    }
    return true;
  }
  function navigationFocusables() {
    return [menuButton, ...left.querySelectorAll("a[href], summary, button")].filter((node) => !node.inert && navigationNodeVisible(node));
  }
  function syncNavigationIsolation() {
    const mobile = isMobileNavigation();
    const open = mobile && document.body.dataset["docsNavigationOpen"] === "true";
    left.inert = mobile && !open;
    for (const node of [brand, searchButton, themeControl, requiredMain, right])
      node.inert = open;
    backdrop.inert = !open;
    if (!mobile && document.body.dataset["docsNavigationOpen"] === "true") {
      document.body.dataset["docsNavigationOpen"] = "false";
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Open documentation menu");
    }
  }
  function revealCurrentNavigationLink() {
    if (currentNavigationLink === undefined)
      return;
    const columnBox = left.getBoundingClientRect();
    const linkBox = currentNavigationLink.getBoundingClientRect();
    if (linkBox.top >= columnBox.top && linkBox.bottom <= columnBox.bottom)
      return;
    left.scrollTop = Math.max(0, left.scrollTop + linkBox.top - columnBox.top - (left.clientHeight - linkBox.height) / 2);
  }
  function setNavigationOpen(open, restoreFocus = !open) {
    document.body.dataset["docsNavigationOpen"] = String(open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close documentation menu" : "Open documentation menu");
    syncNavigationIsolation();
    if (open && isMobileNavigation()) {
      const focusTarget = currentNavigationLink ?? navigationFocusables()[1];
      focusTarget?.focus({ preventScroll: true });
      revealCurrentNavigationLink();
    } else if (restoreFocus)
      menuButton.focus();
  }
  menuButton.addEventListener("click", () => setNavigationOpen(document.body.dataset["docsNavigationOpen"] !== "true"));
  backdrop.addEventListener("click", () => setNavigationOpen(false));
  navigation.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement)
      setNavigationOpen(false, false);
  });
  window.addEventListener("resize", syncNavigationIsolation);
  syncNavigationIsolation();
  revealCurrentNavigationLink();
  const dialog = element("dialog", "docs-search");
  dialog.setAttribute("aria-label", "Search documentation");
  const searchForm = element("form", "docs-search-form");
  searchForm.setAttribute("role", "search");
  const searchInput = element("input", "docs-search-input");
  searchInput.type = "search";
  searchInput.placeholder = "Search titles, concepts, contracts, and events";
  searchInput.setAttribute("aria-label", "Search documentation");
  const closeSearch = element("button", "docs-search-close", "Close");
  closeSearch.type = "button";
  searchForm.append(searchInput, closeSearch);
  const searchStatus = element("p", "docs-search-status", "Start typing to search all documentation.");
  searchStatus.setAttribute("role", "status");
  const retrySearch = element("button", "docs-search-retry", "Retry search");
  retrySearch.type = "button";
  retrySearch.hidden = true;
  const searchResults = element("ol", "docs-search-results");
  dialog.append(searchForm, searchStatus, retrySearch, searchResults);
  document.body.append(dialog);
  let searchIndex = isSearchIndex(window.statoblastDocsSearch) ? window.statoblastDocsSearch : undefined;
  let searchLoadPromise;
  let searchLoadFailed = false;
  function loadSearchIndex() {
    if (searchIndex !== undefined)
      return Promise.resolve(searchIndex);
    if (searchLoadPromise !== undefined)
      return searchLoadPromise;
    searchLoadPromise = new Promise((resolve, reject) => {
      const searchScript = document.createElement("script");
      searchScript.src = docsUrl("assets/js/docsSearchData.js");
      searchScript.addEventListener("load", () => {
        if (!isSearchIndex(window.statoblastDocsSearch)) {
          searchLoadPromise = undefined;
          reject(new Error("Documentation search data is malformed"));
          return;
        }
        searchIndex = window.statoblastDocsSearch;
        resolve(searchIndex);
      });
      searchScript.addEventListener("error", () => {
        searchLoadPromise = undefined;
        reject(new Error("Documentation search data failed to load"));
      });
      document.head.append(searchScript);
    });
    return searchLoadPromise;
  }
  function beginSearchLoad() {
    searchLoadFailed = false;
    retrySearch.hidden = true;
    searchStatus.textContent = "Loading documentation search…";
    loadSearchIndex().then(updateSearch).catch(() => {
      searchLoadFailed = true;
      searchStatus.textContent = "Search is unavailable.";
      retrySearch.hidden = false;
    });
  }
  function openSearch() {
    if (!dialog.open)
      dialog.showModal();
    searchInput.focus();
    if (searchIndex === undefined && !searchLoadFailed)
      beginSearchLoad();
  }
  function closeSearchDialog() {
    dialog.close();
    searchButton.focus();
  }
  searchButton.addEventListener("click", openSearch);
  closeSearch.addEventListener("click", closeSearchDialog);
  retrySearch.addEventListener("click", beginSearchLoad);
  function searchResultLinks() {
    return Array.from(searchResults.querySelectorAll("a[href]"));
  }
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchResultLinks()[0]?.click();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown")
      return;
    const firstResult = searchResultLinks()[0];
    if (firstResult === undefined)
      return;
    event.preventDefault();
    firstResult.focus();
  });
  searchResults.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
      return;
    const links = searchResultLinks();
    const index = links.findIndex((link) => link === document.activeElement);
    if (index < 0)
      return;
    event.preventDefault();
    if (event.key === "ArrowDown")
      links[Math.min(index + 1, links.length - 1)]?.focus();
    else if (index === 0)
      searchInput.focus();
    else
      links[index - 1]?.focus();
  });
  searchResults.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a[href]") !== null)
      dialog.close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog)
      closeSearchDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && isMobileNavigation() && document.body.dataset["docsNavigationOpen"] === "true") {
      const focusables = navigationFocusables();
      const first = focusables[0];
      const last = focusables.at(-1);
      if (first === undefined || last === undefined)
        return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    } else if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !/^(?:INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) {
      event.preventDefault();
      openSearch();
    } else if (event.key === "Escape" && document.body.dataset["docsNavigationOpen"] === "true") {
      setNavigationOpen(false);
      menuButton.focus();
    }
  });
  function normalized(value) {
    return value.toLocaleLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }
  const searchStopWords = new Set(["a", "an", "and", "are", "by", "can", "do", "does", "for", "from", "how", "i", "in", "is", "it", "my", "of", "on", "or", "the", "to", "what", "when", "where", "which", "who", "why", "with"]);
  const searchSuffixes = ["ions", "ion", "ings", "ing", "ers", "er", "ed", "es", "e", "s"];
  function searchStem(term) {
    if (/\d/.test(term))
      return term;
    for (const suffix of searchSuffixes) {
      if (term.endsWith(suffix) && term.length - suffix.length >= 4)
        return term.slice(0, -suffix.length);
    }
    return term;
  }
  function searchTerms(query) {
    const words = query.split(/\s+/).filter((word) => word.length > 0);
    const meaningful = words.filter((word) => !searchStopWords.has(word));
    return (meaningful.length > 0 ? meaningful : words).map(searchStem);
  }
  const searchSectionRank = ["tutorials", "how-to", "start-here", "explanation", "reference"];
  function sectionRankForTitle(sectionTitle) {
    const sectionId = data.sections.find((section) => section.title === sectionTitle)?.id ?? "";
    const rank = searchSectionRank.indexOf(sectionId);
    return rank < 0 ? searchSectionRank.length : rank;
  }
  function searchTermScore(entry, normalizedTitle, term) {
    if (normalizedTitle.startsWith(term))
      return 8;
    if (normalizedTitle.includes(term))
      return 5;
    const heading = normalized(entry.heading);
    if (heading.startsWith(term))
      return 6;
    if (heading.includes(term))
      return 4;
    if (entry.keywords.some((keyword) => normalized(keyword).includes(term)))
      return 3;
    if (normalized(entry.summary).includes(term))
      return 2;
    return 1;
  }
  function updateSearch() {
    const query = normalized(searchInput.value);
    searchResults.replaceChildren();
    if (searchIndex === undefined) {
      searchStatus.textContent = searchLoadFailed ? "Search is unavailable." : "Loading documentation search…";
      retrySearch.hidden = !searchLoadFailed;
      return;
    }
    retrySearch.hidden = true;
    if (query.length < 2) {
      searchStatus.textContent = "Enter at least two characters.";
      return;
    }
    const terms = searchTerms(query);
    const matchesByPath = new Map;
    for (const entry of searchIndex) {
      const title = normalized(entry.title);
      const haystack = normalized(`${entry.title} ${entry.sectionTitle} ${entry.topic} ${entry.keywords.join(" ")} ${entry.summary} ${entry.heading} ${entry.text}`);
      if (!terms.every((term) => haystack.includes(term)))
        continue;
      const score = terms.reduce((total, term) => total + searchTermScore(entry, title, term), entry.weight);
      const previous = matchesByPath.get(entry.path);
      if (previous === undefined || score > previous.score)
        matchesByPath.set(entry.path, { entry, score });
    }
    const matches = Array.from(matchesByPath.values()).sort((left, right) => right.score - left.score || sectionRankForTitle(left.entry.sectionTitle) - sectionRankForTitle(right.entry.sectionTitle) || left.entry.title.localeCompare(right.entry.title)).slice(0, 20);
    searchStatus.textContent = matches.length === 0 ? "No matching documentation." : `${matches.length} result${matches.length === 1 ? "" : "s"}`;
    for (const { entry } of matches) {
      const item = element("li", "");
      const link = element("a", "");
      link.href = docsUrl(entry.path, entry.fragment);
      const snippet = entry.heading.length > 0 ? `${entry.heading} — ${entry.summary}` : entry.summary;
      link.append(element("span", "docs-search-result-meta", `${entry.sectionTitle} · ${entry.topic}`), element("strong", "", entry.title), element("span", "docs-search-result-snippet", snippet));
      item.append(link);
      searchResults.append(item);
    }
  }
  searchInput.addEventListener("input", updateSearch);
  const outlineTargets = Array.from(outlineLinks.keys()).flatMap((id) => {
    const target = document.getElementById(id);
    return target === null ? [] : [{ id, target }];
  });
  const mobileOutlineLinks = Array.from(mobileOutline.querySelectorAll("a[href]"));
  const stickyPanels = Array.from(main.querySelectorAll("[data-docs-sticky]"));
  function coveredViewportTop() {
    const headerBottom = topbar.getBoundingClientRect().bottom;
    return stickyPanels.reduce((bottom, panel) => {
      const box = panel.getBoundingClientRect();
      return box.top <= headerBottom + 24 && box.bottom > bottom ? box.bottom : bottom;
    }, headerBottom);
  }
  function currentOutlineId() {
    const visibleTargets = outlineTargets.filter(({ target }) => target.getClientRects().length > 0);
    const threshold = coveredViewportTop() + 24;
    let currentId;
    for (const { id, target } of visibleTargets) {
      if (target.getBoundingClientRect().top <= threshold)
        currentId = id;
    }
    const atPageEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atPageEnd) {
      for (const { id, target } of visibleTargets) {
        if (target.getBoundingClientRect().top < window.innerHeight)
          currentId = id;
      }
    }
    return currentId;
  }
  function updateOutlineHighlight() {
    const currentId = currentOutlineId();
    const currentHref = currentId === undefined ? undefined : `#${encodeURIComponent(currentId)}`;
    for (const link of [...outlineLinks.values(), ...mobileOutlineLinks]) {
      if (link.getAttribute("href") === currentHref)
        link.setAttribute("aria-current", "location");
      else
        link.removeAttribute("aria-current");
    }
  }
  if (outlineTargets.length > 0) {
    let outlineUpdateScheduled = false;
    const scheduleOutlineUpdate = () => {
      if (outlineUpdateScheduled)
        return;
      outlineUpdateScheduled = true;
      requestAnimationFrame(() => {
        outlineUpdateScheduled = false;
        updateOutlineHighlight();
      });
    };
    window.addEventListener("scroll", scheduleOutlineUpdate, { passive: true });
    window.addEventListener("resize", scheduleOutlineUpdate);
    window.addEventListener("hashchange", scheduleOutlineUpdate);
    window.addEventListener("load", scheduleOutlineUpdate, { once: true });
    updateOutlineHighlight();
  }
})();
